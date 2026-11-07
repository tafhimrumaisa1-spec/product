import type { IsoDate, Money } from './types.js';

/** Parse "60,000.00" / "60000" / "12.5" into integer minor units (2 decimals). No floats. */
export function parseAmountToMinor(s: string): number | null {
  const m = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/.exec(s.trim());
  if (!m) return null;
  const whole = Number((m[1] as string).replace(/,/g, ''));
  const frac = Number(((m[2] ?? '') + '00').slice(0, 2));
  const v = whole * 100 + frac;
  return Number.isSafeInteger(v) ? v : null;
}

export function formatMoney(m: Money): string {
  const sign = m.amountMinor < 0 ? '-' : '';
  const abs = Math.abs(m.amountMinor);
  const whole = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${m.currency} ${whole}.${(abs % 100).toString().padStart(2, '0')}`;
}

// ------------------------------------------------------------------- dates

interface Ymd {
  readonly y: number;
  readonly m: number;
  readonly d: number;
}

export function parseIsoDate(s: string): Ymd | null {
  const r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!r) return null;
  const y = Number(r[1]);
  const m = Number(r[2]);
  const d = Number(r[3]);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return { y, m, d };
}

const fmt = (y: number, m: number, d: number): IsoDate =>
  `${y.toString().padStart(4, '0')}-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;

export function addDaysIso(date: IsoDate, days: number): IsoDate | null {
  const p = parseIsoDate(date);
  if (!p) return null;
  const dt = new Date(Date.UTC(p.y, p.m - 1, p.d + days));
  return fmt(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/** Add whole months, clamping the day to the target month's length. */
export function addMonthsIso(date: IsoDate, months: number): IsoDate | null {
  const p = parseIsoDate(date);
  if (!p) return null;
  const idx = p.y * 12 + (p.m - 1) + months;
  const y = Math.floor(idx / 12);
  const m = (idx % 12) + 1;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return fmt(y, m, Math.min(p.d, last));
}

/**
 * Whole months in [start, endInclusive], or null if the range does not align
 * to whole months (e.g. 2026-01-01..2026-06-30 → 6).
 */
export function wholeMonthsInclusive(start: IsoDate, endInclusive: IsoDate): number | null {
  const endExclusive = addDaysIso(endInclusive, 1);
  if (endExclusive === null) return null;
  const a = parseIsoDate(start);
  const b = parseIsoDate(endExclusive);
  if (!a || !b || a.d !== b.d) return null;
  return (b.y - a.y) * 12 + (b.m - a.m);
}

export const compareIso = (a: IsoDate, b: IsoDate): number => (a < b ? -1 : a > b ? 1 : 0);
