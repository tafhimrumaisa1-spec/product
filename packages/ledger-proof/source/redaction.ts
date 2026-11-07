/** Privacy helpers: salted commitments, field redaction, identifier masking, secret guard. */
import { type JsonValue } from './canonical.js';
import type { AuditEvent } from './events.js';
import { sha256Hex } from './sha256.js';

export type RedactionProfile = 'auditor' | 'public';
export const REDACTED = '[REDACTED]';

/** Salted commitment: sha256("fluxmandate:commit:v1:" + salt + ":" + value). The salt stays off-chain. */
export function createSaltedCommitment(value: string, salt: string): string {
  if (salt.length < 16) throw new Error('Salt must be at least 16 characters');
  return sha256Hex(`fluxmandate:commit:v1:${salt}:${value}`);
}

export function verifyCommitment(commitment: string, value: string, salt: string): boolean {
  return createSaltedCommitment(value, salt) === commitment;
}

/** Hex salt from WebCrypto when available (Node ≥ 19, browsers, edge). Throws instead of falling back to a non-cryptographic source. */
export function generateSalt(bytes = 16): string {
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (!c?.getRandomValues) throw new Error('No secure random source available');
  return Array.from(c.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
}

const PROFILE_KEYS: Readonly<Record<RedactionProfile, ReadonlySet<string>>> = {
  auditor: new Set(['excerptPreview', 'customerRef']),
  public: new Set([
    'excerptPreview', 'customerRef', 'memo', 'description', 'vendorName', 'title',
    'approvedBy', 'grantedBy', 'revokedBy', 'reasonText',
  ]),
};

export function redactedKeysFor(profile: RedactionProfile): ReadonlySet<string> {
  return PROFILE_KEYS[profile];
}

/** Returns a deep copy with every property whose key is in `keys` replaced by "[REDACTED]". */
export function redactValue(value: JsonValue, keys: ReadonlySet<string>): JsonValue {
  if (Array.isArray(value)) return value.map((v) => redactValue(v, keys));
  if (value !== null && typeof value === 'object') {
    const out: { [k: string]: JsonValue } = {};
    for (const [k, v] of Object.entries(value)) out[k] = keys.has(k) ? REDACTED : redactValue(v, keys);
    return out;
  }
  return value;
}

export interface RedactedEvent {
  readonly sequence: number;
  readonly eventId: string;
  readonly type: AuditEvent['type'];
  readonly occurredAt: string;
  /** Hash of the ORIGINAL event, so a verifier holding the original can match it. */
  readonly originalHash: string;
  readonly prevHash: string;
  readonly payload: JsonValue;
  readonly redacted: true;
  readonly profile: RedactionProfile;
}

export function redactEvent(event: AuditEvent, profile: RedactionProfile): RedactedEvent {
  return {
    sequence: event.sequence, eventId: event.eventId, type: event.type, occurredAt: event.occurredAt,
    originalHash: event.hash, prevHash: event.prevHash,
    payload: redactValue(event.payload as unknown as JsonValue, PROFILE_KEYS[profile]),
    redacted: true, profile,
  };
}

/** "AbCd…WxYz" – for showing addresses/signatures compactly. */
export function maskIdentifier(id: string, keepStart = 4, keepEnd = 4): string {
  if (id.length <= keepStart + keepEnd + 1) return id;
  return `${id.slice(0, keepStart)}…${id.slice(id.length - keepEnd)}`;
}

const SECRET_KEY = /(private|secret)[_-]?key|mnemonic|seed[_-]?phrase|keypair|api[_-]?key|password|passphrase|bearer|authorization|signing[_-]?key/i;

/** Returns JSON paths whose key names look like secrets. Names only – values are never inspected or echoed. */
export function findSecretFields(value: unknown, path = '$'): string[] {
  const hits: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((v, i) => hits.push(...findSecretFields(v, `${path}[${i}]`)));
  } else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY.test(k)) hits.push(`${path}.${k}`);
      hits.push(...findSecretFields(v, `${path}.${k}`));
    }
  }
  return hits;
}
