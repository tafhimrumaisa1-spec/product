import { test } from 'node:test';
import assert from 'node:assert/strict';
import { goldenDemoInput, runTwin, MAX_MINOR, SCHEMA_VERSION, ENGINE_VERSION } from '../src/advanced';
import { clone, errorsOf, mutate, ob, run, scenario, small } from './helpers';

/* ---------- golden demo: every number below was derived by hand (see TEST_REPORT.md) ---------- */

test('golden demo: base scenario headline matches hand calculation', () => {
  const o = run(goldenDemoInput());
  const base = scenario(o, 'base');
  assert.equal(o.schemaVersion, SCHEMA_VERSION);
  assert.equal(o.engineVersion, ENGINE_VERSION);
  assert.equal(o.headline.availableCashMinor, 150_000_000);
  assert.equal(o.headline.contractuallyCommittedCapitalMinor, 45_200_000); // 19 x 800k lease + 12 x 2.5M compute
  assert.equal(base.after.contractuallyCommittedCapital.existingMinor, 15_200_000);
  assert.equal(base.after.contractuallyCommittedCapital.proposedMinor, 30_000_000);
  assert.equal(base.after.contractuallyCommittedCapital.beyondHorizonMinor, 0);
  assert.equal(base.before.safeToDeployCapitalMinor, 23_800_000); // ending 38.8M - reserve 15M
  assert.equal(base.after.safeToDeployCapitalMinor, 0);
  assert.equal(base.before.monthlyNetBurn.averageMinor, 4_633_333); // 111.2M / 24
  assert.equal(base.after.monthlyNetBurn.averageMinor, 7_086_458); // 170.075M / 24
  assert.equal(base.before.endingCashMinor, 38_800_000);
  assert.equal(base.after.endingCashMinor, -20_075_000);
  assert.deepEqual(base.before.runway, { status: 'funded_through_horizon', monthsX100: null, horizonMonths: 24 });
  assert.deepEqual(base.after.runway, { status: 'depleted', monthsX100: 2_096, depletionMonth: '2028-08', depletionMonthOffset: 20 });
  assert.equal(base.deltas.runwayChangeMonthsX100, 2_096 - 2_400);
  assert.equal(base.deltas.runwayChangeIsLowerBound, true);
});

test('golden demo: obligation timeline', () => {
  const base = scenario(run(goldenDemoInput()), 'base');
  const compute = base.obligationTimeline.filter((e) => e.obligationId === 'obl-compute-services');
  assert.equal(compute.length, 12 + 11);
  assert.equal(compute[0]!.month, '2027-01');
  assert.equal(compute[0]!.amountMinor, 2_500_000);
  assert.equal(compute[11]!.month, '2027-12');
  assert.equal(compute[12]!.month, '2028-01');
  assert.equal(compute[12]!.amountMinor, 2_625_000); // +5% renewal uplift
  assert.equal(compute[12]!.phase, 'renewal');
  assert.equal(compute.every((e) => e.origin === 'proposed'), true);
  const lease = base.obligationTimeline.filter((e) => e.obligationId === 'obl-office-lease');
  assert.equal(lease.length, 19);
  assert.equal(lease[0]!.month, '2026-12');
  assert.equal(lease[18]!.month, '2028-06');
});

test('golden demo: scenario results', () => {
  const o = run(goldenDemoInput());
  const rw = (id: string) => scenario(o, id).after.runway;
  assert.deepEqual(o.scenarios.map((s) => s.scenario.id), ['base', 'revenue_down', 'revenue_up', 'higher_compute_usage', 'renewal_off', 'delayed_customer_payments', 'combined_downside']);
  assert.equal(rw('higher_compute_usage').monthsX100, 1_787); // hand-derived
  assert.equal(scenario(o, 'revenue_up').after.runway.status, 'funded_through_horizon');
  assert.equal(scenario(o, 'revenue_up').after.safeToDeployCapitalMinor, 36_925_000);
  assert.equal(scenario(o, 'renewal_off').after.runway.status, 'funded_through_horizon');
  assert.equal(scenario(o, 'renewal_off').after.endingCashMinor, 8_800_000); // 150M - 141.2M
  assert.equal(scenario(o, 'renewal_off').after.safeToDeployCapitalMinor, 0); // 8.8M < 15M reserve
  assert.equal(rw('delayed_customer_payments').monthsX100, 1_671);
  assert.equal(rw('revenue_down').monthsX100, 1_478);
  assert.equal(rw('combined_downside').monthsX100, 1_123);
  assert.equal(o.comparison.worstCaseScenarioId, 'combined_downside');
  assert.equal(o.comparison.bestCaseScenarioId, 'revenue_up');
  assert.equal(o.comparison.conservativeSafeToDeployMinor, 0);
});

test('scenario assumptions: presets override the base fields as documented', () => {
  const o = run(goldenDemoInput());
  const a = (id: string) => scenario(o, id).scenario.assumptions;
  assert.equal(a('revenue_down').revenueChangeBps, -2_000);
  assert.equal(a('revenue_up').revenueChangeBps, 2_000);
  assert.equal(a('higher_compute_usage').usageMultiplierBps, 15_000);
  assert.equal(a('renewal_off').renewalsEnabled, false);
  assert.equal(a('delayed_customer_payments').customerPaymentDelayMonths, 2);
  assert.deepEqual(a('combined_downside'), { revenueChangeBps: -2_000, usageMultiplierBps: 15_000, renewalsEnabled: true, customerPaymentDelayMonths: 2, delayedRevenueShareBps: 10_000 });
  assert.deepEqual(a('base'), goldenDemoInput().baseAssumptions);
  assert.equal(a('revenue_down').usageMultiplierBps, 10_000); // untouched fields inherit base
});

test('combined downside forces renewals on even if base has them off; preset parameters are tunable', () => {
  const o = run(mutate((i) => { i.baseAssumptions.renewalsEnabled = false; i.presetParameters = { downsideRevenueBps: -5_000, delayMonths: 4, highUsageMultiplierBps: 20_000, upsideRevenueBps: 500 }; }));
  assert.equal(scenario(o, 'combined_downside').scenario.assumptions.renewalsEnabled, true);
  assert.equal(scenario(o, 'base').scenario.assumptions.renewalsEnabled, false);
  assert.equal(scenario(o, 'revenue_down').scenario.assumptions.revenueChangeBps, -5_000);
  assert.equal(scenario(o, 'revenue_up').scenario.assumptions.revenueChangeBps, 500);
  assert.equal(scenario(o, 'delayed_customer_payments').scenario.assumptions.customerPaymentDelayMonths, 4);
});

test('extra scenarios are appended after presets and echo their assumptions', () => {
  const extra = { id: 'my_case', label: 'Mine', description: 'custom', assumptions: { revenueChangeBps: -500, usageMultiplierBps: 12_000, renewalsEnabled: false, customerPaymentDelayMonths: 1, delayedRevenueShareBps: 5_000 } };
  const o = run(mutate((i) => { i.extraScenarios = [extra]; }));
  assert.equal(o.scenarios.length, 8);
  assert.equal(o.scenarios[7]!.scenario.id, 'my_case');
  assert.deepEqual(o.scenarios[7]!.scenario.assumptions, extra.assumptions);
  assert.equal(o.comparison.rows.length, 8);
});

test('every ScenarioResult and the output carry the assumptions used', () => {
  const o = run(goldenDemoInput());
  for (const s of o.scenarios) assert.ok(s.scenario.assumptions && typeof s.scenario.assumptions.revenueChangeBps === 'number');
  assert.equal(o.assumptionsUsed.cashBalanceMinor, 150_000_000);
});

/* ---------- revenue, delay ---------- */

test('revenue change: rounding half away from zero and -100% / +1000%', () => {
  const rev = (bps: number, mrr: number) => run(small((i) => { i.monthlyRecurringRevenueMinor = mrr; i.baseAssumptions.revenueChangeBps = bps; i.horizonMonths = 1; })).scenarios[0]!.timeline.after[0]!.collectedRevenueMinor;
  assert.equal(rev(-10_000, 1_000), 0);
  assert.equal(rev(100_000, 1_000), 11_000);
  assert.equal(rev(5, 1_000), 1_001); // 1000.5 -> 1001
  assert.equal(rev(-5, 1_000), 1_000); // 999.5 -> 1000
  assert.equal(rev(-2_000, 15_000_000), 12_000_000);
});

test('delayed customer payments: collections slip and receivables accumulate', () => {
  const o = run(small((i) => {
    i.horizonMonths = 6; i.monthlyRecurringRevenueMinor = 1_000; i.cashBalanceMinor = 0;
    i.baseAssumptions.customerPaymentDelayMonths = 2;
  }));
  const rows = o.scenarios[0]!.timeline.after;
  assert.deepEqual(rows.map((r) => r.collectedRevenueMinor), [0, 0, 1_000, 1_000, 1_000, 1_000]);
  assert.deepEqual(rows.map((r) => r.uncollectedReceivablesMinor), [1_000, 2_000, 2_000, 2_000, 2_000, 2_000]);
});

test('delay longer than the horizon collects nothing and never throws', () => {
  const o = run(small((i) => { i.horizonMonths = 3; i.monthlyRecurringRevenueMinor = 500; i.baseAssumptions.customerPaymentDelayMonths = 12; }));
  const rows = o.scenarios[0]!.timeline.after;
  assert.deepEqual(rows.map((r) => r.collectedRevenueMinor), [0, 0, 0]);
  assert.deepEqual(rows.map((r) => r.uncollectedReceivablesMinor), [500, 1_000, 1_500]);
});

test('partial delayed share: immediate part collected now, delayed part later', () => {
  const o = run(small((i) => {
    i.horizonMonths = 4; i.monthlyRecurringRevenueMinor = 1_000; i.baseAssumptions.customerPaymentDelayMonths = 1; i.baseAssumptions.delayedRevenueShareBps = 2_500;
  }));
  assert.deepEqual(o.scenarios[0]!.timeline.after.map((r) => r.collectedRevenueMinor), [750, 1_000, 1_000, 1_000]);
});

test('delay 0 means no receivables regardless of share', () => {
  const o = run(small((i) => { i.monthlyRecurringRevenueMinor = 1_000; i.baseAssumptions.delayedRevenueShareBps = 5_000; }));
  assert.ok(o.scenarios[0]!.timeline.after.every((r) => r.uncollectedReceivablesMinor === 0 && r.collectedRevenueMinor === 1_000));
});

/* ---------- runway boundaries ---------- */

test('runway: cash lasts exactly N months => depleted at the end of month N', () => {
  const o = run(small((i) => { i.cashBalanceMinor = 1_000; i.existingMonthlyBurnMinor = 100; i.horizonMonths = 12; }));
  const r = o.scenarios[0]!.after.runway;
  assert.deepEqual(r, { status: 'depleted', monthsX100: 1_000, depletionMonth: '2026-10', depletionMonthOffset: 9 });
});

test('runway: one minor unit more cash survives one extra month fraction', () => {
  const r = run(small((i) => { i.cashBalanceMinor = 1_001; i.existingMonthlyBurnMinor = 100; i.horizonMonths = 12; })).scenarios[0]!.after.runway;
  assert.deepEqual(r, { status: 'depleted', monthsX100: 1_001, depletionMonth: '2026-11', depletionMonthOffset: 10 });
});

test('runway: one minor unit less cash', () => {
  const r = run(small((i) => { i.cashBalanceMinor = 999; i.existingMonthlyBurnMinor = 100; i.horizonMonths = 12; })).scenarios[0]!.after.runway;
  assert.deepEqual(r, { status: 'depleted', monthsX100: 999, depletionMonth: '2026-10', depletionMonthOffset: 9 });
});

test('runway: zero cash with positive burn is depleted immediately (0.00 months)', () => {
  const o = run(small((i) => { i.cashBalanceMinor = 0; i.existingMonthlyBurnMinor = 1; }));
  const s = o.scenarios[0]!;
  assert.deepEqual(s.after.runway, { status: 'depleted', monthsX100: 0, depletionMonth: '2026-01', depletionMonthOffset: 0 });
  assert.equal(s.after.safeToDeployCapitalMinor, 0);
});

test('runway: zero cash, zero flows is NOT depleted', () => {
  const s = run(small((i) => { i.cashBalanceMinor = 0; })).scenarios[0]!;
  assert.equal(s.after.runway.status, 'funded_through_horizon');
  assert.equal(s.after.safeToDeployCapitalMinor, 0);
  assert.equal(s.after.monthlyNetBurn.averageMinor, 0);
});

test('runway: cash exactly zero at horizon end with burn is depleted at the final month', () => {
  const s = run(small((i) => { i.cashBalanceMinor = 1_200; i.existingMonthlyBurnMinor = 100; i.horizonMonths = 12; })).scenarios[0]!;
  assert.deepEqual(s.after.runway, { status: 'depleted', monthsX100: 1_200, depletionMonth: '2026-12', depletionMonthOffset: 11 });
});

test('runway: cash one unit above horizon need is funded through horizon', () => {
  const s = run(small((i) => { i.cashBalanceMinor = 1_201; i.existingMonthlyBurnMinor = 100; i.horizonMonths = 12; })).scenarios[0]!;
  assert.equal(s.after.runway.status, 'funded_through_horizon');
  assert.equal(s.after.endingCashMinor, 1);
});

test('runway with a net-positive company is funded; net burn is negative', () => {
  const s = run(small((i) => { i.monthlyRecurringRevenueMinor = 500; i.existingMonthlyBurnMinor = 200; i.cashBalanceMinor = 100; })).scenarios[0]!;
  assert.equal(s.after.runway.status, 'funded_through_horizon');
  assert.equal(s.after.monthlyNetBurn.averageMinor, -300);
  assert.equal(s.after.monthlyNetBurn.peakMinor, -300);
  assert.equal(s.after.endingCashMinor, 100 + 12 * 300);
});

test('monthly net burn average rounds half away from zero', () => {
  // outflows: one payment of 5 in 2 months => average 2.5 -> 3 ; negative mirror
  const pos = run(small((i) => { i.horizonMonths = 2; i.existingObligations = [ob({ cadence: 'one_time', termMonths: 1, amountMinor: 5 })]; })).scenarios[0]!;
  assert.equal(pos.after.monthlyNetBurn.averageMinor, 3);
  const neg = run(small((i) => { i.horizonMonths = 2; i.monthlyRecurringRevenueMinor = 5; i.existingMonthlyBurnMinor = 0; i.cashBalanceMinor = 0; i.existingObligations = [ob({ cadence: 'one_time', termMonths: 1, amountMinor: 5 })]; })).scenarios[0]!;
  // month0 net 0, month1 net +5 -> outflow average = -2.5 -> -3
  assert.equal(neg.after.monthlyNetBurn.averageMinor, -3);
});

/* ---------- safe to deploy ---------- */

test('safe to deploy is limited by a FUTURE low point, not just today\u2019s cash', () => {
  const o = run(small((i) => {
    i.cashBalanceMinor = 10_000; i.monthlyRecurringRevenueMinor = 1_000; i.horizonMonths = 8;
    i.existingObligations = [ob({ id: 'big', cadence: 'one_time', termMonths: 1, termStartMonth: '2026-04', amountMinor: 9_000 })];
    i.policy.minimumCashReserveMinor = 500;
  }));
  const s = o.scenarios[0]!;
  // path: 11000,12000,13000,5000(apr: +1000-9000),... lowest closing is April = 10000+4*1000-9000 = 5000
  assert.equal(s.after.safeToDeployCapitalMinor, 4_500);
  assert.deepEqual(s.after.safeToDeployBinding, { monthOffset: 3, month: '2026-04', cashMinor: 5_000 });
});

test('safe to deploy: opening cash is the binding point when cash only grows', () => {
  const s = run(small((i) => { i.cashBalanceMinor = 10_000; i.monthlyRecurringRevenueMinor = 1_000; i.policy.minimumCashReserveMinor = 2_000; })).scenarios[0]!;
  assert.equal(s.after.safeToDeployCapitalMinor, 8_000);
  assert.deepEqual(s.after.safeToDeployBinding, { monthOffset: null, month: null, cashMinor: 10_000 });
});

test('safe to deploy: reserve larger than cash, or equal to cash, gives 0', () => {
  assert.equal(run(small((i) => { i.policy.minimumCashReserveMinor = 10_001; })).scenarios[0]!.after.safeToDeployCapitalMinor, 0);
  assert.equal(run(small((i) => { i.policy.minimumCashReserveMinor = 10_000; })).scenarios[0]!.after.safeToDeployCapitalMinor, 0);
  assert.equal(run(small((i) => { i.policy.minimumCashReserveMinor = 9_999; })).scenarios[0]!.after.safeToDeployCapitalMinor, 1);
});

test('safe to deploy: spending exactly that amount keeps cash at the reserve, one more breaches it', () => {
  const base = small((i) => { i.cashBalanceMinor = 50_000; i.existingMonthlyBurnMinor = 1_000; i.horizonMonths = 12; i.policy.minimumCashReserveMinor = 5_000; });
  const safe = run(base).scenarios[0]!.after.safeToDeployCapitalMinor;
  assert.equal(safe, 50_000 - 12_000 - 5_000);
  const spent = (extra: number) => run({ ...clone(base), cashBalanceMinor: 50_000 - extra }).scenarios[0]!.after.minimumClosingCash.minor;
  assert.equal(spent(safe), 5_000);
  assert.equal(spent(safe + 1), 4_999);
});

/* ---------- committed capital ---------- */

test('committed capital excludes payments before the start month and counts remaining initial-term payments', () => {
  const s = run(small((i) => { i.existingObligations = [ob({ termStartMonth: '2025-10', termMonths: 12 })]; })).scenarios[0]!;
  const item = s.after.contractuallyCommittedCapital.items[0]!;
  assert.equal(item.remainingPaymentCount, 9); // 2026-01..2026-09
  assert.equal(item.totalMinor, 9_000);
  assert.equal(item.lastPaymentMonth, '2026-09');
});

test('committed capital: fully expired contract commits nothing; future contract beyond horizon is reported', () => {
  const s = run(small((i) => {
    i.horizonMonths = 6;
    i.existingObligations = [ob({ id: 'old', termStartMonth: '2024-01', termMonths: 12 })];
    i.proposedObligations = [ob({ id: 'fut', termStartMonth: '2026-04', termMonths: 12, amountMinor: 100 })];
  })).scenarios[0]!;
  const c = s.after.contractuallyCommittedCapital;
  assert.equal(c.items.find((x) => x.obligationId === 'old')!.totalMinor, 0);
  assert.equal(c.items.find((x) => x.obligationId === 'old')!.lastPaymentMonth, null);
  const fut = c.items.find((x) => x.obligationId === 'fut')!;
  assert.equal(fut.totalMinor, 1_200);
  assert.equal(fut.withinHorizonMinor, 300); // Apr, May, Jun
  assert.equal(fut.beyondHorizonMinor, 900);
  assert.equal(c.totalMinor, c.withinHorizonMinor + c.beyondHorizonMinor);
  assert.equal(c.totalMinor, c.existingMinor + c.proposedMinor);
});

test('committed capital ignores usage overage and renewals (it is the contractual floor)', () => {
  const o = run(small((i) => { i.existingObligations = [ob({ usageSensitive: true, periodicCapMinor: 5_000, renewal: { autoRenews: true, renewalTermMonths: 12, renewalAmountChangeBps: 1_000 } })]; }));
  for (const s of o.scenarios) assert.equal(s.after.contractuallyCommittedCapital.totalMinor, 12_000);
});

test('arrears payment in the final month of a term still counts as committed', () => {
  const s = run(small((i) => { i.existingObligations = [ob({ cadence: 'annual', termMonths: 12, paymentTiming: 'arrears', amountMinor: 7_000 })]; })).scenarios[0]!;
  assert.equal(s.after.contractuallyCommittedCapital.totalMinor, 7_000);
  assert.equal(s.obligationTimeline[0]!.month, '2026-12');
});

/* ---------- usage / cap / renewal in scenarios ---------- */

test('higher compute usage: cap binds in the usage scenario and is flagged', () => {
  const o = run(mutate((i) => { i.presetParameters = { highUsageMultiplierBps: 20_000 }; }));
  const s = scenario(o, 'higher_compute_usage');
  const pays = s.obligationTimeline.filter((e) => e.obligationId === 'obl-compute-services');
  assert.equal(pays[0]!.amountMinor, 4_000_000); // 2.5M x 2 = 5M, capped at 4M
  assert.equal(pays[0]!.capped, true);
  assert.equal(pays[12]!.amountMinor, 4_000_000); // renewal base 2.625M x 2 = 5.25M -> 4M
  assert.ok(s.riskFlags.some((f) => f.code === 'USAGE_CAP_REACHED'));
  assert.ok(!scenario(o, 'base').riskFlags.some((f) => f.code === 'USAGE_CAP_REACHED'));
});

test('higher compute usage below the cap is not flagged as capped', () => {
  const s = scenario(run(goldenDemoInput()), 'higher_compute_usage');
  const p = s.obligationTimeline.find((e) => e.obligationId === 'obl-compute-services')!;
  assert.equal(p.amountMinor, 3_750_000);
  assert.equal(p.capped, false);
  assert.equal(p.usageScaled, true);
});

test('renewal off removes renewal payments only', () => {
  const s = scenario(run(goldenDemoInput()), 'renewal_off');
  assert.equal(s.obligationTimeline.filter((e) => e.phase === 'renewal').length, 0);
  assert.equal(s.obligationTimeline.filter((e) => e.obligationId === 'obl-compute-services').length, 12);
  assert.equal(scenario(run(goldenDemoInput()), 'base').obligationTimeline.filter((e) => e.phase === 'renewal').length, 11);
});

/* ---------- no proposals ---------- */

test('no proposed obligations: before equals after and a NO_PROPOSED_OBLIGATIONS info flag is raised', () => {
  const o = run(mutate((i) => { i.proposedObligations = []; }));
  for (const s of o.scenarios) {
    assert.deepEqual(s.before, s.after);
    assert.equal(s.deltas.runwayChangeMonthsX100, 0);
    assert.equal(s.deltas.safeToDeployChangeMinor, 0);
    assert.ok(s.riskFlags.some((f) => f.code === 'NO_PROPOSED_OBLIGATIONS' && f.severity === 'info'));
  }
});

test('no obligations at all and nothing else configured still produces output', () => {
  const o = run(small());
  assert.equal(o.scenarios.length, 7);
  assert.equal(o.headline.contractuallyCommittedCapitalMinor, 0);
});

/* ---------- determinism, purity, serialisation ---------- */

test('deterministic: identical input gives deep-equal output; key order is stable', () => {
  const a = run(goldenDemoInput());
  const b = run(goldenDemoInput());
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('does not mutate its input (deep-frozen input works)', () => {
  const deepFreeze = (v: unknown): unknown => {
    if (typeof v === 'object' && v !== null) { Object.values(v).forEach(deepFreeze); Object.freeze(v); }
    return v;
  };
  const input = deepFreeze(goldenDemoInput());
  const before = JSON.stringify(input);
  assert.ok(runTwin(input).ok);
  assert.equal(JSON.stringify(input), before);
});

test('output is JSON-safe: round-trips unchanged, no undefined / NaN / Infinity / bigint', () => {
  const o = run(goldenDemoInput());
  assert.deepEqual(JSON.parse(JSON.stringify(o)), o);
  const walk = (v: unknown, path: string): void => {
    if (typeof v === 'number') assert.ok(Number.isSafeInteger(v), `non-integer number at ${path}: ${v}`);
    else if (Array.isArray(v)) v.forEach((x, k) => walk(x, `${path}[${k}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
    else assert.ok(v === null || ['string', 'boolean'].includes(typeof v), `bad value at ${path}`);
  };
  walk(o, 'output');
});

test('output does not alias the caller\u2019s input objects', () => {
  const input = goldenDemoInput();
  const o = run(input);
  input.cashBalanceMinor = 1;
  input.baseAssumptions.revenueChangeBps = 999;
  assert.equal(o.assumptionsUsed.cashBalanceMinor, 150_000_000);
  assert.equal(o.assumptionsUsed.baseAssumptions.revenueChangeBps, 0);
});

/* ---------- overflow / size ---------- */

test('arithmetic overflow is reported as an explicit error, not a wrong number', () => {
  const many = Array.from({ length: 500 }, (_, k) => ob({ id: `big${k}`, amountMinor: MAX_MINOR, termMonths: 24 }));
  const errs = errorsOf(small((i) => { i.cashBalanceMinor = MAX_MINOR; i.existingObligations = many; i.horizonMonths = 24; }));
  assert.equal(errs[0]!.code, 'ARITHMETIC_OVERFLOW');
});

test('maximum-size valid input (120 months, many obligations) completes', () => {
  const list = Array.from({ length: 100 }, (_, k) => ob({ id: `o${k}`, amountMinor: 10, termMonths: 120, cadence: k % 2 ? 'monthly' : 'annual' }));
  const o = run(small((i) => { i.horizonMonths = 120; i.cashBalanceMinor = 1_000_000_000; i.existingObligations = list; }));
  assert.equal(o.scenarios[0]!.timeline.after.length, 120);
});

test('runTwin returns errors (never throws) for hostile input', () => {
  assert.equal(runTwin(undefined).ok, false);
  assert.equal(runTwin({}).ok, false);
});
