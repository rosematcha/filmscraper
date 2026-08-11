import type { KeyValue } from '../store/kv.js';

export type TokenKind = 'confirm' | 'manage';

export interface Subscriber {
  readonly email: string;
  readonly firstName?: string;
  /** Section ids from the tables registry; what the digest should include. */
  readonly tables: readonly string[];
  readonly status: 'pending' | 'confirmed';
  readonly createdAt: string;
  readonly confirmedAt?: string;
  /** When the confirmation email last went out; throttles resends. */
  readonly confirmSentAt: string;
  /**
   * Hashes of the two live tokens, kept on the record so a purge can remove
   * the token mappings without knowing the tokens themselves.
   */
  readonly confirmTokenHash: string;
  readonly manageTokenHash: string;
}

interface TokenRef {
  readonly emailHash: string;
  readonly kind: TokenKind;
}

const SUB = 'sub/';
const TOK = 'tok/';

function isSubscriber(value: unknown): value is Subscriber {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record['email'] === 'string' &&
    (record['status'] === 'pending' || record['status'] === 'confirmed') &&
    Array.isArray(record['tables']) &&
    typeof record['confirmTokenHash'] === 'string' &&
    typeof record['manageTokenHash'] === 'string'
  );
}

function isTokenRef(value: unknown): value is TokenRef {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record['emailHash'] === 'string' &&
    (record['kind'] === 'confirm' || record['kind'] === 'manage')
  );
}

function parse<T>(raw: string | null, guard: (value: unknown) => value is T): T | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return guard(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Subscriber records and token mappings over one key-value namespace.
 *
 * A token is resolved by direct key lookup rather than by comparing values,
 * which is inherently timing-safe: an attacker's guess either names a key or
 * it does not.
 */
export class SubscriberStore {
  constructor(private readonly kv: KeyValue) {}

  async get(emailHash: string): Promise<Subscriber | null> {
    return parse(await this.kv.get(SUB + emailHash), isSubscriber);
  }

  async put(emailHash: string, subscriber: Subscriber): Promise<void> {
    await this.kv.set(SUB + emailHash, JSON.stringify(subscriber));
  }

  async delete(emailHash: string): Promise<void> {
    const existing = await this.get(emailHash);
    if (existing) {
      await this.kv.delete(TOK + existing.confirmTokenHash);
      await this.kv.delete(TOK + existing.manageTokenHash);
    }
    await this.kv.delete(SUB + emailHash);
  }

  async putToken(tokenHash: string, emailHash: string, kind: TokenKind): Promise<void> {
    await this.kv.set(TOK + tokenHash, JSON.stringify({ emailHash, kind }));
  }

  async deleteToken(tokenHash: string): Promise<void> {
    await this.kv.delete(TOK + tokenHash);
  }

  /** The subscriber a token belongs to, or null for a wrong or spent token. */
  async lookupToken(
    tokenHash: string,
  ): Promise<{ emailHash: string; kind: TokenKind; subscriber: Subscriber } | null> {
    const ref = parse(await this.kv.get(TOK + tokenHash), isTokenRef);
    if (!ref) return null;
    const subscriber = await this.get(ref.emailHash);
    if (!subscriber) return null;
    return { emailHash: ref.emailHash, kind: ref.kind, subscriber };
  }

  /** Everyone the weekly digest goes to. */
  async listConfirmed(): Promise<Subscriber[]> {
    const keys = await this.kv.list(SUB);
    const out: Subscriber[] = [];
    for (const key of keys) {
      const subscriber = parse(await this.kv.get(key), isSubscriber);
      if (subscriber?.status === 'confirmed') out.push(subscriber);
    }
    return out;
  }
}
