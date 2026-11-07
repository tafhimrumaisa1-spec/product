/**
 * Integer minor-unit arithmetic. Everything that can overflow or round goes
 * through here so the failure mode is an explicit MoneyError, never a silent
 * float artefact.
 */

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/** Largest accepted single input amount: 10^13 minor units. */
export const MAX_MINOR = 10_000_000_000_000;
export const BPS_DENOMINATOR = 10_000;

const SAFE_MAX = BigInt(Number.MAX_SAFE_INTEGER);
const SAFE_MIN = BigInt(Number.MIN_SAFE_INTEGER);

function fromBig(v: bigint, ctx: string): number {
  if (v > SAFE_MAX || v < SAFE_MIN) {
    throw new MoneyError(`${ctx}: result exceeds the safe integer range`);
  }
  return Number(v);
}

export function assertSafeInteger(n: number, ctx: string): number {
  if (!Number.isSafeInteger(n)) {
    throw new MoneyError(`${ctx}: ${String(n)} is not a safe integer`);
  }
  return n;
}

export function add(a: number, b: number): number {
  assertSafeInteger(a, 'add');
  assertSafeInteger(b, 'add');
  return fromBig(BigInt(a) + BigInt(b), 'add');
}

export function sub(a: number, b: number): number {
  assertSafeInteger(a, 'sub');
  assertSafeInteger(b, 'sub');
  return fromBig(BigInt(a) - BigInt(b), 'sub');
}

export function sum(values: readonly number[]): number {
  let acc = 0n;
  for (const v of values) {
    assertSafeInteger(v, 'sum');
    acc += BigInt(v);
  }
  return fromBig(acc, 'sum');
}

/**
 * round(a * b / d), halves rounded away from zero. d must be > 0.
 * The intermediate product is exact (BigInt).
 */
export function mulDivRound(a: number, b: number, d: number): number {
  assertSafeInteger(a, 'mulDivRound.a');
  assertSafeInteger(b, 'mulDivRound.b');
  assertSafeInteger(d, 'mulDivRound.d');
  if (d <= 0) throw new MoneyError('mulDivRound: divisor must be positive');
  const num = BigInt(a) * BigInt(b);
  const D = BigInt(d);
  const neg = num < 0n;
  const abs = neg ? -num : num;
  const q = (2n * abs + D) / (2n * D);
  return fromBig(neg ? -q : q, 'mulDivRound');
}

/** round(n / d), halves away from zero. */
export function divRound(n: number, d: number): number {
  return mulDivRound(n, 1, d);
}

/** floor(n * 100 / d) for n >= 0, d > 0 (hundredths of a unit). */
export function floorHundredths(n: number, d: number): number {
  assertSafeInteger(n, 'floorHundredths.n');
  assertSafeInteger(d, 'floorHundredths.d');
  if (n < 0 || d <= 0) throw new MoneyError('floorHundredths: requires n >= 0 and d > 0');
  return fromBig((BigInt(n) * 100n) / BigInt(d), 'floorHundredths');
}

/** Exact test of amount > base * bps / 10_000 (no rounding involved). */
export function exceedsShare(amount: number, base: number, bps: number): boolean {
  return BigInt(amount) * 10_000n > BigInt(base) * BigInt(bps);
}

/** amount * (10_000 + bps) / 10_000, rounded half away from zero. */
export function applyBps(amount: number, bps: number): number {
  return mulDivRound(amount, BPS_DENOMINATOR + bps, BPS_DENOMINATOR);
}
