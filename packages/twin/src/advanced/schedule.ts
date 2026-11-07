import { applyBps, mulDivRound, BPS_DENOMINATOR } from './money';
import { cadenceMonths, formatMonth, parseMonth } from './months';
import type {
  NormalizedObligation,
  ObligationOrigin,
  PaymentEvent,
  ScenarioAssumptions,
} from './types';

export interface ScheduledPayment {
  monthIndex: number;
  cycle: number;
  cycleBaseAmountMinor: number;
}

interface Cycle {
  cycle: number;
  startIndex: number;
  termMonths: number;
  baseAmountMinor: number;
}

function startIndexOf(ob: NormalizedObligation): number {
  const idx = parseMonth(ob.termStartMonth);
  if (idx === null) throw new Error(`schedule: obligation ${ob.id} has an unvalidated month`); // unreachable after validation
  return idx;
}

/**
 * Contract cycles in order: cycle 0 = initial term, then renewals while allowed.
 * A cycle is yielded only while its start is before `startBeforeIndex`.
 */
function* cycles(
  ob: NormalizedObligation,
  renewalsEnabled: boolean,
  startBeforeIndex: number | null,
): Generator<Cycle> {
  let cycle = 0;
  let start = startIndexOf(ob);
  let len = ob.termMonths;
  let amount = ob.amountMinor;
  for (;;) {
    if (cycle > 0) {
      if (!renewalsEnabled || ob.renewal === null || !ob.renewal.autoRenews) return;
      if (startBeforeIndex === null) return;
    }
    if (startBeforeIndex !== null && start >= startBeforeIndex) return;
    yield { cycle, startIndex: start, termMonths: len, baseAmountMinor: amount };
    if (startBeforeIndex === null) return; // initial term only
    start += len;
    cycle += 1;
    if (ob.renewal !== null) {
      len = ob.renewal.renewalTermMonths;
      amount = applyBps(amount, ob.renewal.renewalAmountChangeBps);
    }
  }
}

function paymentsOfCycle(ob: NormalizedObligation, c: Cycle): ScheduledPayment[] {
  const interval = cadenceMonths(ob.cadence, c.termMonths);
  const count = c.termMonths / interval;
  const out: ScheduledPayment[] = [];
  for (let k = 0; k < count; k++) {
    const periodStart = c.startIndex + k * interval;
    const monthIndex = ob.paymentTiming === 'advance' ? periodStart : periodStart + interval - 1;
    out.push({ monthIndex, cycle: c.cycle, cycleBaseAmountMinor: c.baseAmountMinor });
  }
  return out;
}

/** All payments of the initial term (no renewals, no usage scaling), regardless of any horizon. */
export function initialTermPayments(ob: NormalizedObligation): ScheduledPayment[] {
  const out: ScheduledPayment[] = [];
  for (const c of cycles(ob, false, null)) out.push(...paymentsOfCycle(ob, c));
  return out;
}

/**
 * Payments falling in [windowStart, windowEndExclusive) under the scenario assumptions,
 * with usage scaling and the periodic cap applied.
 */
export function paymentsInWindow(
  ob: NormalizedObligation,
  origin: ObligationOrigin,
  windowStart: number,
  windowEndExclusive: number,
  assumptions: ScenarioAssumptions,
): PaymentEvent[] {
  const out: PaymentEvent[] = [];
  for (const c of cycles(ob, assumptions.renewalsEnabled, windowEndExclusive)) {
    for (const p of paymentsOfCycle(ob, c)) {
      if (p.monthIndex < windowStart || p.monthIndex >= windowEndExclusive) continue;
      const base = p.cycleBaseAmountMinor;
      let amount = base;
      let capped = false;
      if (ob.usageSensitive) {
        amount = mulDivRound(base, assumptions.usageMultiplierBps, BPS_DENOMINATOR);
        if (amount < base) amount = base; // committed floor
        if (ob.periodicCapMinor !== null && amount > ob.periodicCapMinor) {
          const ceiling = Math.max(ob.periodicCapMinor, base);
          if (ceiling < amount) {
            amount = ceiling;
            capped = true;
          }
        }
      }
      out.push({
        obligationId: ob.id,
        origin,
        month: formatMonth(p.monthIndex),
        monthOffset: p.monthIndex - windowStart,
        phase: p.cycle === 0 ? 'initial_term' : 'renewal',
        renewalCycle: p.cycle,
        baseAmountMinor: base,
        amountMinor: amount,
        usageScaled: amount > base,
        capped,
      });
    }
  }
  return out;
}

/** First renewal-cycle start (>= windowStart) of an auto-renewing contract, or null. */
export function nextRenewalStart(ob: NormalizedObligation, windowStart: number): number | null {
  if (ob.renewal === null || !ob.renewal.autoRenews) return null;
  let start = startIndexOf(ob) + ob.termMonths;
  while (start < windowStart) start += ob.renewal.renewalTermMonths;
  return start;
}
