import assert from 'node:assert/strict';
import { runTwin, goldenDemoInput } from '../src/advanced';
import type { ObligationInput, TwinInput, TwinOutput, TwinError } from '../src/advanced';

export const clone = <T>(v: T): T => structuredClone(v);

export function mutate(fn: (i: TwinInput) => void): unknown {
  const i = goldenDemoInput();
  fn(i);
  return i;
}

export function run(input: unknown): TwinOutput {
  const r = runTwin(input);
  if (!r.ok) assert.fail('expected ok, got errors: ' + JSON.stringify(r.errors));
  return r.output;
}

export function errorsOf(input: unknown): TwinError[] {
  const r = runTwin(input);
  if (r.ok) assert.fail('expected errors but run succeeded');
  return r.errors;
}

export function scenario(o: TwinOutput, id: string) {
  const s = o.scenarios.find((x) => x.scenario.id === id);
  if (!s) assert.fail(`scenario ${id} not found`);
  return s;
}

/** A minimal obligation; override what you need. */
export function ob(over: Partial<ObligationInput> = {}): ObligationInput {
  return {
    id: 'o1', label: 'Test', counterparty: 'Cp', amountMinor: 1_000, cadence: 'monthly',
    termStartMonth: '2026-01', termMonths: 12, paymentTiming: 'advance', usageSensitive: false,
    periodicCapMinor: null, renewal: null, terminationNoticeMonths: 0, externalRef: null, ...over,
  };
}

/** A small, round-number company; overrides via callback. */
export function small(fn: (i: TwinInput) => void = () => undefined): TwinInput {
  const i: TwinInput = {
    currency: 'USD', startMonth: '2026-01', horizonMonths: 12,
    cashBalanceMinor: 10_000, monthlyRecurringRevenueMinor: 0, existingMonthlyBurnMinor: 0,
    existingObligations: [], proposedObligations: [],
    baseAssumptions: { revenueChangeBps: 0, usageMultiplierBps: 10_000, renewalsEnabled: true, customerPaymentDelayMonths: 0, delayedRevenueShareBps: 10_000 },
    policy: { minimumCashReserveMinor: 0, minimumRunwayMonths: 0 },
  };
  fn(i);
  return i;
}
