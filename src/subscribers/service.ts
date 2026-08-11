import { DEFAULT_TABLE_IDS, knownTables } from '../core/sections.js';
import { confirmationEmail } from './emails.js';
import type { Mailer } from './mailer.js';
import { SubscriberStore, type Subscriber } from './store.js';
import { emailKey, newToken, normalizeEmail, sha256Hex } from './tokens.js';

/**
 * One confirmation email per address per day, whatever the signup form is
 * asked. This is the throttle that keeps the endpoint from being turned into
 * a harassment tool or a way to burn the daily send quota.
 */
export const CONFIRM_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export const MAX_NAME_LENGTH = 50;
const MAX_EMAIL_LENGTH = 254;
/** Shape check only; the confirmation email is the real validator. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ServiceDeps {
  readonly store: SubscriberStore;
  readonly mailer: Mailer;
  /** Origin the emailed links point at, e.g. https://example.com */
  readonly siteUrl: string;
  readonly now?: () => Date;
}

export interface SubscribeRequest {
  readonly email: string;
  readonly firstName?: string | undefined;
  readonly tables?: readonly string[] | undefined;
}

export function validEmail(raw: string): string | null {
  const email = normalizeEmail(raw);
  if (email.length === 0 || email.length > MAX_EMAIL_LENGTH) return null;
  return EMAIL_SHAPE.test(email) ? email : null;
}

/** Trim, drop control characters, cap the length; empty collapses to absent. */
export function cleanName(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const name = raw
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, MAX_NAME_LENGTH);
  return name === '' ? undefined : name;
}

/**
 * Start a subscription: write a pending record and send the confirmation.
 *
 * Everything short of a malformed address reports success, and an address
 * already on the list sends nothing — the response must not say whether an
 * address is subscribed, and repeat requests must not generate repeat email.
 */
export async function subscribe(
  deps: ServiceDeps,
  request: SubscribeRequest,
): Promise<'ok' | 'invalid-email'> {
  const email = validEmail(request.email);
  if (email === null) return 'invalid-email';

  const now = (deps.now ?? (() => new Date()))();
  const hash = emailKey(email);
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await deps.store.getVersioned(hash);
    const existing = current?.subscriber ?? null;
    if (existing?.status === 'confirmed') return 'ok';
    if (
      existing?.status === 'pending' &&
      now.getTime() - Date.parse(existing.confirmSentAt) < CONFIRM_COOLDOWN_MS
    ) {
      return 'ok';
    }

    const confirmToken = newToken();
    const manageToken = newToken();
    const firstName = cleanName(request.firstName);
    const tables = knownTables(request.tables ?? []);
    const subscriber: Subscriber = {
      email,
      ...(firstName !== undefined ? { firstName } : {}),
      tables: tables.length > 0 ? tables : DEFAULT_TABLE_IDS,
      status: 'pending',
      createdAt: existing && existing.status !== 'deleted' ? existing.createdAt : now.toISOString(),
      confirmSentAt: now.toISOString(),
      confirmTokenHash: sha256Hex(confirmToken),
      manageTokenHash: sha256Hex(manageToken),
    };

    try {
      // Token refs are unique, disposable indexes. Install them before the
      // authoritative subscriber CAS; until that succeeds, lookup rejects them.
      await deps.store.putToken(subscriber.confirmTokenHash, hash, 'confirm');
      await deps.store.putToken(subscriber.manageTokenHash, hash, 'manage');
      const written = current
        ? await deps.store.update(hash, subscriber, current.etag)
        : await deps.store.create(hash, subscriber);
      if (!written.modified || written.etag === undefined) {
        await Promise.allSettled([
          deps.store.deleteToken(subscriber.confirmTokenHash),
          deps.store.deleteToken(subscriber.manageTokenHash),
        ]);
        continue;
      }

      try {
        await deps.mailer.send(
          confirmationEmail({
            to: email,
            firstName,
            confirmUrl: `${deps.siteUrl}/api/confirm?token=${confirmToken}`,
          }),
        );
      } catch (error) {
        // Roll back only if this generation is still current. A concurrent
        // confirm or resend wins instead of being overwritten by cleanup.
        const retryable = existing ?? { ...subscriber, confirmSentAt: new Date(0).toISOString() };
        await deps.store.update(hash, retryable, written.etag).catch(() => undefined);
        await Promise.allSettled([
          deps.store.deleteToken(subscriber.confirmTokenHash),
          deps.store.deleteToken(subscriber.manageTokenHash),
        ]);
        throw error;
      }

      if (existing) {
        await Promise.allSettled([
          deps.store.deleteToken(existing.confirmTokenHash),
          deps.store.deleteToken(existing.manageTokenHash),
        ]);
      }
      return 'ok';
    } catch (error) {
      await Promise.allSettled([
        deps.store.deleteToken(subscriber.confirmTokenHash),
        deps.store.deleteToken(subscriber.manageTokenHash),
      ]);
      throw error;
    }
  }
  // Another invocation kept winning the CAS; it owns the response and email.
  return 'ok';
}

/** Complete the double opt-in. The token is single-use. */
export async function confirm(deps: ServiceDeps, token: string): Promise<boolean> {
  const found = await deps.store.lookupToken(sha256Hex(token));
  if (found?.kind !== 'confirm' || found.subscriber.status !== 'pending') return false;

  const now = (deps.now ?? (() => new Date()))();
  const updated = await deps.store.update(
    found.emailHash,
    {
      ...found.subscriber,
      status: 'confirmed',
      confirmedAt: now.toISOString(),
    },
    found.etag,
  );
  if (!updated.modified) return false;
  await deps.store.deleteToken(sha256Hex(token)).catch(() => undefined);
  return true;
}

/**
 * Unsubscribe, which here means purge: the record and both token mappings are
 * deleted outright. There is nothing else to keep — the subscription is the
 * only data the system holds.
 */
export async function unsubscribe(deps: ServiceDeps, token: string): Promise<boolean> {
  const found = await deps.store.lookupToken(sha256Hex(token));
  if (found?.kind !== 'manage') return false;
  // Blobs has conditional writes but no conditional delete. Replace the
  // authoritative record with a PII-free tombstone so an old request cannot
  // delete or restore a concurrent newer generation.
  const removed = await deps.store.update(
    found.emailHash,
    {
      email: '',
      tables: [],
      status: 'deleted',
      createdAt: '',
      confirmSentAt: '',
      confirmTokenHash: '',
      manageTokenHash: '',
    },
    found.etag,
  );
  if (!removed.modified) return false;
  await Promise.allSettled([
    deps.store.deleteToken(found.subscriber.confirmTokenHash),
    deps.store.deleteToken(found.subscriber.manageTokenHash),
  ]);
  return true;
}
