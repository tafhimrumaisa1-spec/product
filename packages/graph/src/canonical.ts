import { FluxGraphError } from "./errors";

/**
 * Canonical JSON: UTF-16-code-unit sorted keys, no whitespace, finite numbers only.
 * The same logical value always yields the same string, which makes it safe to hash.
 * Rejects undefined, NaN/Infinity, bigint, functions, symbols, Dates, class instances and cycles
 * instead of silently dropping or coercing them.
 */
export function canonicalize(value: unknown): string {
  return encode(value, new Set<object>(), "$");
}

function fail(path: string, what: string): never {
  throw new FluxGraphError("CANONICALIZATION_ERROR", `Cannot canonicalize ${what} at ${path}`);
}

function encode(value: unknown, stack: Set<object>, path: string): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) fail(path, "a non-finite number");
      return JSON.stringify(value);
    case "object":
      break;
    default:
      return fail(path, `a value of type ${typeof value}`);
  }
  const obj = value as object;
  if (stack.has(obj)) fail(path, "a circular reference");
  stack.add(obj);
  try {
    if (Array.isArray(obj)) {
      return `[${obj.map((v, i) => encode(v, stack, `${path}[${i}]`)).join(",")}]`;
    }
    const proto = Object.getPrototypeOf(obj) as unknown;
    if (proto !== Object.prototype && proto !== null) fail(path, "a non-plain object");
    const record = obj as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${encode(record[k], stack, `${path}.${k}`)}`).join(",")}}`;
  } finally {
    stack.delete(obj);
  }
}
