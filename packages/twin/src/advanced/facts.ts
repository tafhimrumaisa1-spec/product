import type { FactValue, Runway } from './types';

export const money = (value: number): FactValue => ({ unit: 'minor_units', value });
export const bps = (value: number): FactValue => ({ unit: 'bps', value });
export const months = (value: number): FactValue => ({ unit: 'months', value });
export const monthsX100 = (value: number | null): FactValue => ({ unit: 'months_x100', value });
export const count = (value: number): FactValue => ({ unit: 'count', value });
export const monthLabel = (value: string | null): FactValue => ({ unit: 'month_label', value });
export const text = (value: string): FactValue => ({ unit: 'text', value });
export const bool = (value: boolean): FactValue => ({ unit: 'boolean', value });

/** 1250 -> "12.50" */
export function formatMonthsX100(n: number): string {
  return `${Math.floor(n / 100)}.${String(n % 100).padStart(2, '0')}`;
}

/** Runway as a comparable number: exact when depleted, the horizon (a lower bound) when funded. */
export function comparableRunwayX100(r: Runway): number {
  return r.status === 'depleted' ? r.monthsX100 : r.horizonMonths * 100;
}

export function runwayFacts(prefix: string, r: Runway): Record<string, FactValue> {
  return {
    [`${prefix}Status`]: text(r.status),
    [`${prefix}MonthsX100`]: monthsX100(r.monthsX100),
    [`${prefix}DepletionMonth`]: monthLabel(r.status === 'depleted' ? r.depletionMonth : null),
  };
}
