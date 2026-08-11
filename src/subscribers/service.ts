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
  const existing = await deps.store.get(hash);

  if (existing?.status === 'confirmed') return 'ok';
  if (existing && now.getTime() - Date.parse(existing.confirmSentAt) < CONFIRM_COOLDOWN_MS) {
    return 'ok';
  }

  // A resend rotates both tokens; the mappings from the stale ones go first
  // so a superseded confirm link stops working.
  if (existing) {
    await deps.store.deleteToken(existing.confirmTokenHash);
    await deps.store.deleteToken(existing.manageTokenHash);
  }

  const confirmToken = newToken();
  const manageToken = newToken();
  const firstName = cleanName(request.firstName);
  const tables = knownTables(request.tables ?? []);

  const subscriber: Subscriber = {
    email,
    ...(firstName !== undefined ? { firstName } : {}),
    // An empty pick would mean a digest with nothing in it; treat it as the
    // default set instead.
    tables: tables.length > 0 ? tables : DEFAULT_TABLE_IDS,
    status: 'pending',
    createdAt: existing?.createdAt ?? now.toISOString(),
    confirmSentAt: now.toISOString(),
    confirmTokenHash: sha256Hex(confirmToken),
    manageTokenHash: sha256Hex(manageToken),
  };

  await deps.store.put(hash, subscriber);
  await deps.store.putToken(subscriber.confirmTokenHash, hash, 'confirm');
  await deps.store.putToken(subscriber.manageTokenHash, hash, 'manage');

  try {
    await deps.mailer.send(
      confirmationEmail({
        to: email,
        firstName,
        confirmUrl: `${deps.siteUrl}/api/confirm?token=${confirmToken}`,
      }),
    );
  } catch (error) {
    // Do not leave an address in the cooldown when no message went out. A
    // resend also has to restore its previous links, since those may already
    // be sitting in the subscriber's inbox.
    await Promise.allSettled([
      deps.store.deleteToken(subscriber.confirmTokenHash),
      deps.store.deleteToken(subscriber.manageTokenHash),
    ]);
    if (existing) {
      await deps.store.put(hash, existing);
      await deps.store.putToken(existing.confirmTokenHash, hash, 'confirm');
      await deps.store.putToken(existing.manageTokenHash, hash, 'manage');
    } else {
      await deps.store.delete(hash);
    }
    throw error;
  }
  return 'ok';
}

/** Complete the double opt-in. The token is single-use. */
export async function confirm(deps: ServiceDeps, token: string): Promise<boolean> {
  const found = await deps.store.lookupToken(sha256Hex(token));
  if (found?.kind !== 'confirm') return false;

  const now = (deps.now ?? (() => new Date()))();
  await deps.store.put(found.emailHash, {
    ...found.subscriber,
    status: 'confirmed',
    confirmedAt: now.toISOString(),
  });
  await deps.store.deleteToken(sha256Hex(token));
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
  await deps.store.delete(found.emailHash);
  return true;
}
