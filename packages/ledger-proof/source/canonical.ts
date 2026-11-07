/** Deterministic JSON serialisation (sorted keys) used for hashing and equality. */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export class CanonicalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalizationError';
  }
}

export function canonicalJson(value: unknown): string {
  return serialize(value, new Set<object>(), '$');
}

function serialize(value: unknown, seen: Set<object>, path: string): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new CanonicalizationError(`Non-finite number at ${path}`);
      return JSON.stringify(value);
    case 'object': {
      if (seen.has(value)) throw new CanonicalizationError(`Cycle at ${path}`);
      seen.add(value);
      let out: string;
      if (Array.isArray(value)) {
        out = '[' + value.map((v, i) => serialize(v === undefined ? null : v, seen, `${path}[${i}]`)).join(',') + ']';
      } else {
        const record = value as Record<string, unknown>;
        const keys = Object.keys(record).filter((k) => record[k] !== undefined).sort();
        out = '{' + keys.map((k) => JSON.stringify(k) + ':' + serialize(record[k], seen, `${path}.${k}`)).join(',') + '}';
      }
      seen.delete(value);
      return out;
    }
    default:
      throw new CanonicalizationError(`Unsupported ${typeof value} at ${path}`);
  }
}

/** Deep-copies a JSON-compatible value and freezes it. */
export function deepFreezeCopy<T>(value: T): T {
  const copy = JSON.parse(canonicalJson(value)) as T;
  freeze(copy);
  return copy;
}

function freeze(value: unknown): void {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
    Object.freeze(value);
  }
}
