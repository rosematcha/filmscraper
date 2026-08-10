import { createHash, randomBytes } from 'node:crypto';

/**
 * Links in email are bearer credentials, so they carry 32 bytes of randomness
 * and the store only ever holds their hash: a leaked subscriber list yields no
 * working confirm or unsubscribe links.
 */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * The blob key for an address. Hashing is key hygiene, not secrecy — the
 * record behind it still holds the address, because sending needs it.
 */
export function emailKey(email: string): string {
  return sha256Hex(normalizeEmail(email));
}
