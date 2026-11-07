import { divRound, floorHundredths, sub, sum } from './money';
import { formatMonth } from './months';
import { initialTermPayments } from './schedule';
import type {
  CommittedCapital,
  CommittedItem,
  MonthlyRow,
  NormalizedObligation,
  ObligationOrigin,
  PositionSummary,
  Runway,
} from './types';

export function computeRunway(rows: readonly MonthlyRow[], horizonMonths: number): Runway {
  for (const r of rows) {
    const outflow = -r.netCashFlowMinor;
    if (r.closingCashMinor <= 0 && outflow > 0) {
      const frac = Math.min(100, floorHundredths(r.openingCashMinor, outflow));
      return {
        status: 'depleted',
        monthsX100: r.monthOffset * 100 + frac,
        depletionMonth: r.month,
        depletionMonthOffset: r.monthOffset,
      };
    }
  }
  return { status: 'funded_through_horizon', monthsX100: null, horizonMonths };
}

export function computeCommitted(
  obligations: ReadonlyArray<{ ob: NormalizedObligation; origin: ObligationOrigin }>,
  startIndex: number,
  horizonMonths: number,
): CommittedCapital {
  const windowEnd = startIndex + horizonMonths;
  const items: CommittedItem[] = obligations.map(({ ob, origin }) => {
    const remaining = initialTermPayments(ob).filter((p) => p.monthIndex >= startIndex);
    const within = remaining.filter((p) => p.monthIndex < windowEnd);
    const beyond = remaining.filter((p) => p.monthIndex >= windowEnd);
    const last = remaining.reduce((m, p) => Math.max(m, p.monthIndex), -1);
    return {
      obligationId: ob.id,
      origin,
      remainingPaymentCount: remaining.length,
      totalMinor: sum(remaining.map((p) => p.cycleBaseAmountMinor)),
      withinHorizonMinor: sum(within.map((p) => p.cycleBaseAmountMinor)),
      beyondHorizonMinor: sum(beyond.map((p) => p.cycleBaseAmountMinor)),
      lastPaymentMonth: last >= 0 ? formatMonth(last) : null,
    };
  });
  const pick = (f: (i: CommittedItem) => number, origin?: ObligationOrigin): number =>
    sum(items.filter((i) => origin === undefined || i.origin === origin).map(f));
  return {
    totalMinor: pick((i) => i.totalMinor),
    existingMinor: pick((i) => i.totalMinor, 'existing'),
    proposedMinor: pick((i) => i.totalMinor, 'proposed'),
    withinHorizonMinor: pick((i) => i.withinHorizonMinor),
    beyondHorizonMinor: pick((i) => i.beyondHorizonMinor),
    items,
  };
}

export interface SummaryParams {
  openingCashMinor: number;
  reserveMinor: number;
  horizonMonths: number;
  rows: readonly MonthlyRow[];
  committed: CommittedCapital;
}

/**
 * safe-to-deploy = max(0, min(opening cash, every month's closing cash) - reserve).
 * Spending X today lowers every future closing balance by X, so the lowest point
 * of the path (minus the reserve) is exactly the headroom.
 */
export function summarize(p: SummaryParams): PositionSummary {
  const { rows } = p;
  let minCash = p.openingCashMinor;
  let minOffset: number | null = null; // null = opening cash is the (earliest) minimum
  let minRow = rows[0] as MonthlyRow;
  let minClosing = Number.POSITIVE_INFINITY;
  for (const r of rows) {
    if (r.closingCashMinor < minCash) {
      minCash = r.closingCashMinor;
      minOffset = r.monthOffset;
    }
    if (r.closingCashMinor < minClosing) {
      minClosing = r.closingCashMinor;
      minRow = r;
    }
  }
  const headroom = sub(minCash, p.reserveMinor);

  const outflows = rows.map((r) => -r.netCashFlowMinor);
  let peak = rows[0] as MonthlyRow;
  for (const r of rows) if (-r.netCashFlowMinor > -peak.netCashFlowMinor) peak = r;
  const first = rows[0] as MonthlyRow;
  const last = rows[rows.length - 1] as MonthlyRow;

  return {
    availableCashMinor: p.openingCashMinor,
    contractuallyCommittedCapital: p.committed,
    safeToDeployCapitalMinor: Math.max(0, headroom),
    safeToDeployBinding: {
      monthOffset: minOffset,
      month: minOffset === null ? null : (rows[minOffset] as MonthlyRow).month,
      cashMinor: minCash,
    },
    monthlyNetBurn: {
      averageMinor: divRound(sum(outflows), p.horizonMonths),
      firstMonthMinor: -first.netCashFlowMinor,
      peakMinor: -peak.netCashFlowMinor,
      peakMonth: peak.month,
    },
    runway: computeRunway(rows, p.horizonMonths),
    minimumClosingCash: { minor: minRow.closingCashMinor, month: minRow.month },
    endingCashMinor: last.closingCashMinor,
    totals: {
      collectedRevenueMinor: sum(rows.map((r) => r.collectedRevenueMinor)),
      operatingBurnMinor: sum(rows.map((r) => r.operatingBurnMinor)),
      obligationPaymentsMinor: sum(rows.map((r) => r.obligationPaymentsMinor)),
    },
  };
}
