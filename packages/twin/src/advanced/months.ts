import type { Cadence, MonthLabel } from './types';

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
export const MIN_YEAR = 2000;
export const MAX_YEAR = 2200;

/** "YYYY-MM" -> absolute month index, or null if malformed / outside 2000..2200. */
export function parseMonth(label: unknown): number | null {
  if (typeof label !== 'string') return null;
  const m = MONTH_RE.exec(label);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (year < MIN_YEAR || year > MAX_YEAR) return null;
  return year * 12 + (month - 1);
}

export function formatMonth(index: number): MonthLabel {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

/** Months between payments. For one_time the whole term is a single period. */
export function cadenceMonths(cadence: Cadence, termMonths: number): number {
  switch (cadence) {
    case 'monthly':
      return 1;
    case 'quarterly':
      return 3;
    case 'semi_annual':
      return 6;
    case 'annual':
      return 12;
    case 'one_time':
      return termMonths;
  }
}
