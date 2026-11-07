import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { goldenDemoInput } from '../src/advanced';
import type { RiskFlagCode, TwinInput } from '../src/advanced';
import { mutate, ob, run, scenario, small } from './helpers';

const codes = (o: ReturnType<typeof run>, id = 'base'): RiskFlagCode[] => scenario(o, id).riskFlags.map((f) => f.code);

/* ---------- risk flags ---------- */

test('golden demo base flags and ordering (critical first)', () => {
  const o = run(goldenDemoInput());
  const flags = scenario(o, 'base').riskFlags;
  assert.deepEqual(flags.map((f) => f.code), ['CASH_DEPLETED_WITHIN_HORIZON', 'AUTO_RENEWAL_IN_HORIZON', 'PROPOSAL_CONSUMES_ALL_SAFE_CAPITAL', 'RESERVE_BREACHED', 'RUNWAY_REDUCED_BY_PROPOSAL']);
  assert.equal(flags[0]!.severity, 'critical');
  assert.equal(flags[0]!.facts.depletionMonth!.value, '2028-08');
  assert.equal(flags[1]!.facts.noticeDeadlineMonth!.value, '2027-11');
  assert.deepEqual(o.headline.riskFlags, flags);
});

test('healthy company: no warnings or criticals', () => {
  const o = run(small((i) => {
    i.cashBalanceMinor = 1_000_000; i.monthlyRecurringRevenueMinor = 10_000; i.existingMonthlyBurnMinor = 5_000;
    i.proposedObligations = [ob({ amountMinor: 100 })];
  }));
  assert.deepEqual(codes(o), []);
});

test('RUNWAY_BELOW_POLICY_MINIMUM boundary: runway exactly at policy is fine, just below is flagged', () => {
  const mk = (cash: number) => run(small((i) => { i.cashBalanceMinor = cash; i.existingMonthlyBurnMinor = 100; i.policy.minimumRunwayMonths = 6; i.horizonMonths = 12; }));
  assert.ok(!codes(mk(600)).includes('RUNWAY_BELOW_POLICY_MINIMUM')); // exactly 6.00 months
  assert.ok(codes(mk(599)).includes('RUNWAY_BELOW_POLICY_MINIMUM')); // 5.99
  assert.ok(codes(mk(599)).includes('CASH_DEPLETED_WITHIN_HORIZON'));
});

test('RUNWAY_NOT_VERIFIABLE_WITHIN_HORIZON when the horizon is shorter than the policy runway', () => {
  const o = run(small((i) => { i.horizonMonths = 3; i.policy.minimumRunwayMonths = 6; }));
  assert.ok(codes(o).includes('RUNWAY_NOT_VERIFIABLE_WITHIN_HORIZON'));
  const o2 = run(small((i) => { i.horizonMonths = 6; i.policy.minimumRunwayMonths = 6; }));
  assert.ok(!codes(o2).includes('RUNWAY_NOT_VERIFIABLE_WITHIN_HORIZON'));
});

test('RESERVE_BREACHED boundary', () => {
  const mk = (reserve: number) => run(small((i) => { i.cashBalanceMinor = 1_000; i.existingMonthlyBurnMinor = 10; i.horizonMonths = 10; i.policy.minimumCashReserveMinor = reserve; }));
  assert.ok(!codes(mk(900)).includes('RESERVE_BREACHED')); // min closing = 900 == reserve
  assert.ok(codes(mk(901)).includes('RESERVE_BREACHED'));
  assert.ok(!codes(mk(0)).includes('RESERVE_BREACHED'));
});

test('LARGE_SINGLE_PAYMENT threshold is exact and proposed-only', () => {
  const mk = (amount: number, list: 'proposedObligations' | 'existingObligations' = 'proposedObligations') =>
    run(small((i) => { i.cashBalanceMinor = 10_000; i[list] = [ob({ cadence: 'one_time', termMonths: 1, amountMinor: amount })]; }));
  assert.ok(!codes(mk(2_500)).includes('LARGE_SINGLE_PAYMENT')); // exactly 25%
  assert.ok(codes(mk(2_501)).includes('LARGE_SINGLE_PAYMENT'));
  assert.ok(!codes(mk(9_000, 'existingObligations')).includes('LARGE_SINGLE_PAYMENT'));
});

test('LARGE_SINGLE_PAYMENT respects a custom policy share', () => {
  const o = run(small((i) => { i.policy.largePaymentShareBps = 100; i.proposedObligations = [ob({ amountMinor: 101 })]; }));
  assert.ok(codes(o).includes('LARGE_SINGLE_PAYMENT'));
});

test('COMMITMENT_EXTENDS_BEYOND_HORIZON only for proposed obligations that run past the horizon', () => {
  const o = run(small((i) => { i.horizonMonths = 6; i.proposedObligations = [ob({ termMonths: 12 })]; i.existingObligations = [ob({ id: 'ex', termMonths: 12 })]; }));
  const f = scenario(o, 'base').riskFlags.find((x) => x.code === 'COMMITMENT_EXTENDS_BEYOND_HORIZON')!;
  assert.deepEqual(f.relatedObligationIds, ['o1']);
  assert.equal(f.facts.beyondHorizonMinor!.value, 6_000);
});

test('AUTO_RENEWAL_IN_HORIZON is only raised when renewals are enabled and the renewal is inside the horizon', () => {
  const o = run(mutate(() => undefined));
  assert.ok(codes(o, 'base').includes('AUTO_RENEWAL_IN_HORIZON'));
  assert.ok(!codes(o, 'renewal_off').includes('AUTO_RENEWAL_IN_HORIZON'));
  const short = run(mutate((i) => { i.horizonMonths = 13; })); // renewal at offset 13 -> outside [0,13)
  assert.ok(!codes(short).includes('AUTO_RENEWAL_IN_HORIZON'));
  const edge = run(mutate((i) => { i.horizonMonths = 14; })); // offset 13 inside
  assert.ok(codes(edge).includes('AUTO_RENEWAL_IN_HORIZON'));
});

test('RENEWAL_NOTICE_WINDOW_PASSED when the notice deadline is before the start month', () => {
  const o = run(small((i) => {
    i.startMonth = '2026-06';
    i.existingObligations = [ob({ termStartMonth: '2025-07', termMonths: 12, terminationNoticeMonths: 3, renewal: { autoRenews: true, renewalTermMonths: 12, renewalAmountChangeBps: 0 } })];
  }));
  // renewal starts 2026-07; deadline 2026-04 < 2026-06
  const f = scenario(o, 'base').riskFlags.find((x) => x.code === 'RENEWAL_NOTICE_WINDOW_PASSED')!;
  assert.equal(f.facts.noticeDeadlineMonth!.value, '2026-04');
  // deadline == start month is still actionable
  const ok = run(small((i) => {
    i.startMonth = '2026-04';
    i.existingObligations = [ob({ termStartMonth: '2025-07', termMonths: 12, terminationNoticeMonths: 3, renewal: { autoRenews: true, renewalTermMonths: 12, renewalAmountChangeBps: 0 } })];
  }));
  assert.ok(!codes(ok).includes('RENEWAL_NOTICE_WINDOW_PASSED'));
});

test('PROPOSAL_CONSUMES_ALL_SAFE_CAPITAL and RUNWAY_REDUCED_BY_PROPOSAL', () => {
  const o = run(small((i) => { i.cashBalanceMinor = 20_000; i.proposedObligations = [ob({ amountMinor: 2_000 })]; }));
  assert.ok(codes(o).includes('PROPOSAL_CONSUMES_ALL_SAFE_CAPITAL')); // 12 x 2000 = 24000 > 20000
  assert.ok(codes(o).includes('RUNWAY_REDUCED_BY_PROPOSAL'));
  const mild = run(small((i) => { i.cashBalanceMinor = 20_000; i.proposedObligations = [ob({ amountMinor: 100 })]; }));
  assert.ok(!codes(mild).includes('PROPOSAL_CONSUMES_ALL_SAFE_CAPITAL'));
  assert.ok(!codes(mild).includes('RUNWAY_REDUCED_BY_PROPOSAL')); // both funded through horizon -> no change in comparable runway
});

test('already-depleted-before-proposal is stated in the fact', () => {
  const o = run(small((i) => { i.cashBalanceMinor = 100; i.existingMonthlyBurnMinor = 50; i.proposedObligations = [ob({ amountMinor: 10 })]; }));
  const f = scenario(o, 'base').riskFlags.find((x) => x.code === 'CASH_DEPLETED_WITHIN_HORIZON')!;
  assert.equal(f.facts.alreadyDepletedBeforeProposal!.value, true);
});

test('flags carry the scenario id they were raised in', () => {
  const o = run(goldenDemoInput());
  for (const s of o.scenarios) for (const f of s.riskFlags) assert.equal(f.scenarioId, s.scenario.id);
});

test('comparison highest severity and flag codes', () => {
  const o = run(goldenDemoInput());
  const row = (id: string) => o.comparison.rows.find((r) => r.scenarioId === id)!;
  assert.equal(row('base').highestSeverity, 'critical');
  assert.equal(row('revenue_up').highestSeverity, 'warning');
  assert.deepEqual(row('base').vsBase, { runwayAfterComparableMonthsX100: 0, safeToDeployAfterMinor: 0, minimumClosingCashAfterMinor: 0, endingCashAfterMinor: 0, monthlyNetBurnAfterMinor: 0 });
  assert.equal(row('revenue_up').vsBase.endingCashAfterMinor, row('revenue_up').endingCashAfterMinor - row('base').endingCashAfterMinor);
  assert.equal(run(small()).comparison.rows[0]!.highestSeverity, 'info'); // NO_PROPOSED_OBLIGATIONS only
});

test('comparison tie-breaks are deterministic (identical scenarios -> first wins best and worst)', () => {
  const same = small().baseAssumptions;
  const o = run(small((i) => { i.extraScenarios = [{ id: 'twin', label: 'Twin', assumptions: same }]; }));
  // all preset scenarios equal base when there is no revenue/obligations; base is first
  assert.equal(o.comparison.worstCaseScenarioId, o.comparison.rows.reduce((w, r) => (r.minimumClosingCashAfterMinor < w.minimumClosingCashAfterMinor ? r : w)).scenarioId);
  assert.equal(o.comparison.bestCaseScenarioId, 'base');
});

/* ---------- explanation facts ---------- */

test('explanation facts: unique ids, non-empty formulas, phrase keys, JSON-safe values', () => {
  const o = run(goldenDemoInput());
  const ids = new Set<string>();
  for (const f of o.explanations) {
    assert.ok(!ids.has(f.factId), `duplicate ${f.factId}`);
    ids.add(f.factId);
    assert.ok(f.formula.length > 0 && f.phraseKey.length > 0);
    assert.ok(['minor_units', 'bps', 'months', 'months_x100', 'count', 'month_label', 'text', 'boolean'].includes(f.result.unit));
  }
  assert.ok(o.explanations.length > 50);
});

test('explanation facts agree with computed positions', () => {
  const o = run(goldenDemoInput());
  const get = (id: string) => o.explanations.find((f) => f.factId === id)!;
  assert.equal(get('available_cash:all:input').result.value, 150_000_000);
  assert.equal(get('committed_capital:all:after').result.value, 45_200_000);
  assert.deepEqual(get('committed_capital:all:after').components.map((c) => [c.ref, c.value.value]), [['obl-office-lease', 15_200_000], ['obl-compute-services', 30_000_000]]);
  assert.equal(get('runway:base:after').result.value, 2_096);
  assert.equal(get('runway:base:after').phraseKey, 'runway.depleted');
  assert.equal(get('runway:base:after').inputs.depletionMonthOpeningCashMinor!.value, 6_425_000);
  assert.equal(get('runway:base:after').inputs.depletionMonthNetOutflowMinor!.value, 6_625_000);
  assert.equal(get('runway:base:before').result.value, null);
  assert.equal(get('runway:base:before').phraseKey, 'runway.funded_through_horizon');
  assert.equal(get('safe_to_deploy:base:before').result.value, 23_800_000);
  assert.equal(get('safe_to_deploy:base:before').inputs.lowestCashPointMonth!.value, '2028-11');
  assert.equal(get('monthly_net_burn:base:after').result.value, 7_086_458);
  assert.equal(get('scenario_delta:base:delta').result.value, -304);
});

test('every risk flag has a matching explanation fact', () => {
  const o = run(goldenDemoInput());
  for (const s of o.scenarios) {
    const facts = o.explanations.filter((f) => f.metric === 'risk_flag' && f.scenarioId === s.scenario.id);
    assert.deepEqual(facts.map((f) => f.result.value), s.riskFlags.map((f) => f.code));
  }
});

test('every scenario has runway, burn, safe-to-deploy and minimum-cash facts for before and after', () => {
  const o = run(goldenDemoInput());
  for (const s of o.scenarios) for (const m of ['runway', 'monthly_net_burn', 'safe_to_deploy', 'minimum_cash']) for (const sub of ['before', 'after']) {
    assert.ok(o.explanations.some((f) => f.factId === `${m}:${s.scenario.id}:${sub}`), `${m}:${s.scenario.id}:${sub}`);
  }
});

/* ---------- repository hygiene ---------- */

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'advanced');
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sourceFiles(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : []));
}

test('source is framework-independent: only relative imports, no node:/network/clock/random APIs', () => {
  for (const f of sourceFiles(srcDir)) {
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(/from\s+'([^']+)'/g)) assert.ok(m[1]!.startsWith('.'), `${f} imports non-relative "${m[1]}"`);
    for (const banned of [/\bDate\b/, /Math\.random/, /\bfetch\s*\(/, /process\.env/, /require\s*\(/, /localStorage/, /\beval\s*\(/, /XMLHttpRequest/]) {
      assert.ok(!banned.test(text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), `${f} uses banned API ${String(banned)}`);
    }
  }
});

test('source contains no secret-like material', () => {
  for (const f of sourceFiles(srcDir)) {
    const text = readFileSync(f, 'utf8');
    for (const re of [/sk-[A-Za-z0-9]{16,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /api[_-]?key\s*[:=]\s*['"][^'"]+['"]/i, /NEXT_PUBLIC_/, /secret\s*[:=]\s*['"][^'"]+['"]/i, /[1-9A-HJ-NP-Za-km-z]{80,}/]) {
      assert.ok(!re.test(text), `${f} matches ${String(re)}`);
    }
  }
});

test('the engine never imports an LLM or network client', () => {
  for (const f of sourceFiles(srcDir)) {
    const text = readFileSync(f, 'utf8');
    assert.ok(!/anthropic|openai|@solana|web3/i.test(text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), f);
  }
});

// keep the TwinInput type import used (compile-time check that the fixture satisfies it)
const _fixtureTypeCheck: TwinInput = goldenDemoInput();
void _fixtureTypeCheck;

test('RUNWAY_REDUCED_BY_PROPOSAL wording only claims "at least" when the change is a bound', () => {
  const exact = run(small((i) => { i.cashBalanceMinor = 1_000; i.existingMonthlyBurnMinor = 100; i.proposedObligations = [ob({ amountMinor: 100, termMonths: 12 })]; }));
  const f = scenario(exact, 'base').riskFlags.find((x) => x.code === 'RUNWAY_REDUCED_BY_PROPOSAL')!;
  assert.equal(f.facts.isLowerBound!.value, false);
  assert.ok(!f.summary.includes('at least'));
  const bound = scenario(run(goldenDemoInput()), 'base').riskFlags.find((x) => x.code === 'RUNWAY_REDUCED_BY_PROPOSAL')!;
  assert.equal(bound.facts.isLowerBound!.value, true);
  assert.ok(bound.summary.includes('at least'));
});
