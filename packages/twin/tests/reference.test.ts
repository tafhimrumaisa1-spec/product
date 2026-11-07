/**
 * Independent reference model. It re-implements the documented rules with plain
 * month-by-month loops and small numbers, deliberately sharing NO code with the
 * engine's schedule/simulate modules, then compares closing balances and runway.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeTwin, validateTwinInput, parseMonth } from '../src/advanced';
import type { NormalizedObligation, NormalizedTwinInput, ScenarioAssumptions } from '../src/advanced';
import { small, ob } from './helpers';

const roundDiv = (num: number, den: number): number => Math.floor((2 * num + den) / (2 * den)); // num >= 0

function refPayment(o: NormalizedObligation, monthIdx: number, a: ScenarioAssumptions): number {
  const start = parseMonth(o.termStartMonth) as number;
  const ms = monthIdx - start;
  if (ms < 0) return 0;
  const interval = o.cadence === 'monthly' ? 1 : o.cadence === 'quarterly' ? 3 : o.cadence === 'semi_annual' ? 6 : o.cadence === 'annual' ? 12 : o.termMonths;
  let cycle = 0;
  let pos = ms;
  if (ms >= o.termMonths) {
    if (!a.renewalsEnabled || !o.renewal || !o.renewal.autoRenews) return 0;
    const r = ms - o.termMonths;
    cycle = 1 + Math.floor(r / o.renewal.renewalTermMonths);
    pos = r % o.renewal.renewalTermMonths;
  }
  const due = o.paymentTiming === 'advance' ? pos % interval === 0 : pos % interval === interval - 1;
  if (!due) return 0;
  let base = o.amountMinor;
  for (let c = 0; c < cycle; c++) base = roundDiv(base * (10_000 + (o.renewal as NonNullable<typeof o.renewal>).renewalAmountChangeBps), 10_000);
  let amt = base;
  if (o.usageSensitive) {
    amt = Math.max(base, roundDiv(base * a.usageMultiplierBps, 10_000));
    if (o.periodicCapMinor !== null && amt > o.periodicCapMinor) amt = Math.max(o.periodicCapMinor, base);
  }
  return amt;
}

function refClosing(inp: NormalizedTwinInput, obs: NormalizedObligation[], a: ScenarioAssumptions): number[] {
  const start = parseMonth(inp.startMonth) as number;
  const rev = roundDiv(inp.monthlyRecurringRevenueMinor * (10_000 + a.revenueChangeBps), 10_000);
  const delayed = roundDiv(rev * a.delayedRevenueShareBps, 10_000);
  const out: number[] = [];
  let cash = inp.cashBalanceMinor;
  for (let t = 0; t < inp.horizonMonths; t++) {
    const collected = rev - delayed + (t >= a.customerPaymentDelayMonths ? delayed : 0);
    let pay = 0;
    for (const o of obs) pay += refPayment(o, start + t, a);
    cash = cash + collected - inp.existingMonthlyBurnMinor - pay;
    out.push(cash);
  }
  return out;
}

function refRunwayX100(inp: NormalizedTwinInput, closing: number[]): number | null {
  let open = inp.cashBalanceMinor;
  for (let t = 0; t < closing.length; t++) {
    const out = open - (closing[t] as number);
    if ((closing[t] as number) <= 0 && out > 0) return t * 100 + Math.min(100, Math.floor((open * 100) / out));
    open = closing[t] as number;
  }
  return null;
}

// Small deterministic PRNG (mulberry32)
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomInput(seed: number) {
  const r = rng(seed);
  const int = (lo: number, hi: number): number => lo + Math.floor(r() * (hi - lo + 1));
  const pick = <T,>(xs: readonly T[]): T => xs[int(0, xs.length - 1)] as T;
  const makeOb = (id: string) => {
    const cadence = pick(['monthly', 'quarterly', 'semi_annual', 'annual', 'one_time'] as const);
    const interval = cadence === 'monthly' ? 1 : cadence === 'quarterly' ? 3 : cadence === 'semi_annual' ? 6 : cadence === 'annual' ? 12 : int(1, 18);
    const periods = int(1, 4);
    const amount = int(100, 50_000);
    const usage = r() < 0.5;
    const renews = cadence !== 'one_time' && r() < 0.6;
    return ob({
      id, amountMinor: amount, cadence,
      termStartMonth: pick(['2025-06', '2026-01', '2026-03', '2026-09', '2027-02']),
      termMonths: interval * periods, paymentTiming: pick(['advance', 'arrears'] as const),
      usageSensitive: usage,
      periodicCapMinor: usage && r() < 0.5 ? amount + int(0, amount) : null,
      renewal: renews ? { autoRenews: true, renewalTermMonths: interval * int(1, 3), renewalAmountChangeBps: int(-3_000, 5_000) } : null,
      terminationNoticeMonths: int(0, 4),
    });
  };
  return small((i) => {
    i.startMonth = pick(['2025-11', '2026-01', '2026-06']);
    i.horizonMonths = int(1, 40);
    i.cashBalanceMinor = int(0, 2_000_000);
    i.monthlyRecurringRevenueMinor = int(0, 150_000);
    i.existingMonthlyBurnMinor = int(0, 150_000);
    i.existingObligations = Array.from({ length: int(0, 3) }, (_, k) => makeOb(`e${k}`));
    i.proposedObligations = Array.from({ length: int(0, 3) }, (_, k) => makeOb(`p${k}`));
    i.baseAssumptions = {
      revenueChangeBps: int(-3_000, 3_000), usageMultiplierBps: int(10_000, 25_000), renewalsEnabled: r() < 0.7,
      customerPaymentDelayMonths: int(0, 4), delayedRevenueShareBps: pick([0, 2_500, 5_000, 10_000]),
    };
    i.policy = { minimumCashReserveMinor: int(0, 300_000), minimumRunwayMonths: int(0, 24) };
  });
}

test('engine matches the independent reference model on 300 random inputs x all scenarios', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const v = validateTwinInput(randomInput(seed));
    assert.ok(v.ok, `seed ${seed} should validate: ${JSON.stringify(!v.ok && v.errors)}`);
    const input = v.value;
    const out = computeTwin(input);
    for (const s of out.scenarios) {
      const a = s.scenario.assumptions;
      const existing = input.existingObligations;
      const all = [...existing, ...input.proposedObligations];
      for (const [subject, obs] of [['before', existing], ['after', all]] as const) {
        const expected = refClosing(input, obs, a);
        const actual = s.timeline[subject].map((r) => r.closingCashMinor);
        assert.deepEqual(actual, expected, `seed ${seed} scenario ${s.scenario.id} ${subject}`);
        const rw = refRunwayX100(input, expected);
        const got = s[subject].runway;
        if (rw === null) assert.equal(got.status, 'funded_through_horizon', `seed ${seed} ${s.scenario.id} ${subject}`);
        else assert.deepEqual([got.status, got.monthsX100], ['depleted', rw], `seed ${seed} ${s.scenario.id} ${subject}`);
        const minPath = Math.min(input.cashBalanceMinor, ...expected);
        assert.equal(s[subject].safeToDeployCapitalMinor, Math.max(0, minPath - input.policy.minimumCashReserveMinor), `seed ${seed} ${s.scenario.id} ${subject} safe`);
      }
    }
  }
});

test('structural invariants hold on random inputs', () => {
  for (let seed = 1000; seed < 1150; seed++) {
    const v = validateTwinInput(randomInput(seed));
    assert.ok(v.ok);
    if (!v.ok) return;
    const out = computeTwin(v.value);
    for (const s of out.scenarios) {
      for (const subject of ['before', 'after'] as const) {
        const rows = s.timeline[subject];
        assert.equal(rows.length, v.value.horizonMonths);
        rows.forEach((r, t) => {
          assert.equal(r.monthOffset, t);
          assert.equal(r.openingCashMinor, t === 0 ? v.value.cashBalanceMinor : (rows[t - 1] as typeof r).closingCashMinor);
          assert.equal(r.closingCashMinor, r.openingCashMinor + r.netCashFlowMinor);
          assert.equal(r.netCashFlowMinor, r.collectedRevenueMinor - r.operatingBurnMinor - r.obligationPaymentsMinor);
          assert.equal(r.obligationBreakdown.reduce((x, b) => x + b.amountMinor, 0), r.obligationPaymentsMinor);
        });
      }
      // adding obligations can only hurt
      assert.ok(s.after.endingCashMinor <= s.before.endingCashMinor);
      assert.ok(s.after.safeToDeployCapitalMinor <= s.before.safeToDeployCapitalMinor);
      assert.ok(s.deltas.runwayChangeMonthsX100 <= 0);
      assert.ok(s.after.safeToDeployCapitalMinor >= 0);
      assert.ok(s.after.safeToDeployCapitalMinor <= s.after.availableCashMinor);
      // event total equals timeline total
      assert.equal(s.obligationTimeline.reduce((x, e) => x + e.amountMinor, 0), s.after.totals.obligationPaymentsMinor);
      // events chronological
      for (let k = 1; k < s.obligationTimeline.length; k++) {
        assert.ok((s.obligationTimeline[k - 1] as { monthOffset: number }).monthOffset <= (s.obligationTimeline[k] as { monthOffset: number }).monthOffset);
      }
    }
  }
});
