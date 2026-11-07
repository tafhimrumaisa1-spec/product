/**
 * Money is carried as decimal strings of integer minor units (e.g. micro-USDC) so events are
 * JSON-safe and no floating point is ever used for amounts. Projections use bigint internally.
 */

export const DEFAULT_CURRENCY = 'USDC';
export const DEFAULT_DECIMALS = 6;

const UNSIGNED_INT = /^(0|[1-9][0-9]*)$/;
const SIGNED_INT = /^-?(0|[1-9][0-9]*)$/;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

export function parseMinor(value: unknown, field = 'amount'): bigint {
  if (typeof value !== 'string' || !UNSIGNED_INT.test(value)) {
    throw new MoneyError(`${field} must be a non-negative integer string of minor units`);
  }
  return BigInt(value);
}

export function parseSignedMinor(value: unknown, field = 'amount'): bigint {
  if (typeof value !== 'string' || !SIGNED_INT.test(value)) {
    throw new MoneyError(`${field} must be an integer string of minor units`);
  }
  return BigInt(value);
}

/** 1_000_000_000n → "1,000.00 USDC". Trailing zeros are trimmed down to 2 decimals. */
export function formatAmount(minor: bigint, currency = DEFAULT_CURRENCY, decimals = DEFAULT_DECIMALS): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const unit = 10n ** BigInt(decimals);
  const whole = (abs / unit).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  let frac = (abs % unit).toString().padStart(decimals, '0').replace(/0+$/, '');
  if (frac.length < 2) frac = frac.padEnd(2, '0');
  return `${negative ? '-' : ''}${whole}.${frac} ${currency}`;
}

/** "1000.5" → 1_000_500_000n (6 decimals). Throws on excess precision. */
export function toMinor(decimal: string, decimals = DEFAULT_DECIMALS): string {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(decimal);
  if (!match) throw new MoneyError(`Invalid decimal amount: ${decimal}`);
  const frac = match[2] ?? '';
  if (frac.length > decimals) throw new MoneyError(`Too many decimal places (max ${decimals})`);
  return (BigInt(match[1] as string) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0') || '0')).toString();
}
