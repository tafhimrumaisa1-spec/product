import { add, mulDivRound, sub, sum, BPS_DENOMINATOR } from './money';
import { formatMonth } from './months';
import { paymentsInWindow } from './schedule';
import type {
  MonthlyRow,
  NormalizedObligation,
  ObligationOrigin,
  PaymentEvent,
  ScenarioAssumptions,
} from './types';

export interface SimulationParams {
  startIndex: number;
  horizonMonths: number;
  openingCashMinor: number;
  monthlyRecurringRevenueMinor: number;
  existingMonthlyBurnMinor: number;
  assumptions: ScenarioAssumptions;
  obligations: ReadonlyArray<{ ob: NormalizedObligation; origin: ObligationOrigin }>;
}

export interface SimulationResult {
  rows: MonthlyRow[];
  events: PaymentEvent[];
}

/**
 * Deterministic month-by-month cash simulation.
 *
 * Within a month: closing = opening + collected revenue - operating burn - obligation payments.
 * Revenue = round(MRR * (1 + revenueChange)). A `delayedRevenueShare` of it is collected
 * `customerPaymentDelayMonths` later; there is no pre-existing receivables backlog.
 * The simulation continues below zero so deficits stay visible.
 */
export function simulate(p: SimulationParams): SimulationResult {
  const { assumptions: a } = p;
  const revenue = mulDivRound(p.monthlyRecurringRevenueMinor, BPS_DENOMINATOR + a.revenueChangeBps, BPS_DENOMINATOR);
  const delayed = mulDivRound(revenue, a.delayedRevenueShareBps, BPS_DENOMINATOR);
  const immediate = sub(revenue, delayed);
  const windowEnd = p.startIndex + p.horizonMonths;

  const events: PaymentEvent[] = [];
  for (const { ob, origin } of p.obligations) {
    events.push(...paymentsInWindow(ob, origin, p.startIndex, windowEnd, a));
  }
  events.sort(
    (x, y) =>
      x.monthOffset - y.monthOffset ||
      (x.obligationId < y.obligationId ? -1 : x.obligationId > y.obligationId ? 1 : 0),
  );

  const byMonth = new Map<number, PaymentEvent[]>();
  for (const e of events) {
    const list = byMonth.get(e.monthOffset);
    if (list) list.push(e);
    else byMonth.set(e.monthOffset, [e]);
  }

  const rows: MonthlyRow[] = [];
  let cash = p.openingCashMinor;
  for (let t = 0; t < p.horizonMonths; t++) {
    const collected = t >= a.customerPaymentDelayMonths ? add(immediate, delayed) : immediate;
    const monthEvents = byMonth.get(t) ?? [];
    const breakdown = monthEvents.map((e) => ({ obligationId: e.obligationId, amountMinor: e.amountMinor }));
    const payments = sum(breakdown.map((b) => b.amountMinor));
    const net = sub(sub(collected, p.existingMonthlyBurnMinor), payments);
    const closing = add(cash, net);
    rows.push({
      monthOffset: t,
      month: formatMonth(p.startIndex + t),
      openingCashMinor: cash,
      collectedRevenueMinor: collected,
      operatingBurnMinor: p.existingMonthlyBurnMinor,
      obligationPaymentsMinor: payments,
      obligationBreakdown: breakdown,
      netCashFlowMinor: net,
      closingCashMinor: closing,
      uncollectedReceivablesMinor: mulDivRound(delayed, Math.min(a.customerPaymentDelayMonths, t + 1), 1),
    });
    cash = closing;
  }
  return { rows, events };
}
