import { createHash } from 'node:crypto';

/**
 * Deterministic JSON: object keys sorted, no whitespace.
 * Throws on values that cannot be represented stably (undefined, NaN, functions…).
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('canonicalJson: non-finite number');
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
      const rec = value as Record<string, unknown>;
      const keys = Object.keys(rec).sort();
      const parts: string[] = [];
      for (const k of keys) {
        const v = rec[k];
        if (v === undefined) throw new TypeError(`canonicalJson: undefined at key "${k}"`);
        parts.push(`${JSON.stringify(k)}:${canonicalJson(v)}`);
      }
      return `{${parts.join(',')}}`;
    }
    default:
      throw new TypeError(`canonicalJson: unsupported type ${typeof value}`);
  }
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export const GENESIS_HASH = '0'.repeat(64);
