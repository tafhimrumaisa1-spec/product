// Minimal ambient declarations so tests type-check without @types/node (not installable offline).
declare module 'node:test' {
  export function describe(name: string, fn: () => void | Promise<void>): void;
  export function it(name: string, fn: () => void | Promise<void>): void;
}
declare module 'node:assert/strict' {
  interface Assert {
    (value: unknown, message?: string): asserts value;
    equal(actual: unknown, expected: unknown, message?: string): void;
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    ok(value: unknown, message?: string): asserts value;
    notEqual(actual: unknown, expected: unknown, message?: string): void;
    rejects(fn: () => Promise<unknown>, check?: (e: unknown) => boolean): Promise<void>;
    throws(fn: () => unknown, check?: (e: unknown) => boolean): void;
  }
  const assert: Assert;
  export default assert;
}
declare module 'node:fs' {
  export function readFileSync(path: string, enc: 'utf8'): string;
  export function readdirSync(path: string, opts: { recursive: true }): string[];
}
declare module 'node:path' {
  export function join(...p: string[]): string;
  export function dirname(p: string): string;
}
declare module 'node:url' {
  export function fileURLToPath(u: string | URL): string;
}
