import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTwin, validateTwinInput, goldenDemoInput, MAX_MINOR } from '../src/advanced';
import type { TwinErrorCode } from '../src/advanced';
import { errorsOf, mutate, ob, run, small } from './helpers';

type Case = [name: string, input: unknown, code: TwinErrorCode, path: string];

const cases: Case[] = [
  ['null input', null, 'INPUT_NOT_OBJECT', ''],
  ['array input', [], 'INPUT_NOT_OBJECT', ''],
  ['string input', 'x', 'INPUT_NOT_OBJECT', ''],
  ['undefined input', undefined, 'INPUT_NOT_OBJECT', ''],
  ['unknown root field (typo)', mutate((i) => Object.assign(i, { cashBalance: 5 })), 'UNKNOWN_FIELD', 'cashBalance'],
  ['float cash', mutate((i) => { i.cashBalanceMinor = 10.5; }), 'NOT_INTEGER', 'cashBalanceMinor'],
  ['NaN cash', mutate((i) => { i.cashBalanceMinor = Number.NaN; }), 'NOT_INTEGER', 'cashBalanceMinor'],
  ['Infinity cash', mutate((i) => { i.cashBalanceMinor = Infinity; }), 'NOT_INTEGER', 'cashBalanceMinor'],
  ['unsafe integer cash', mutate((i) => { i.cashBalanceMinor = 2 ** 60; }), 'NOT_INTEGER', 'cashBalanceMinor'],
  ['string cash', mutate((i) => { (i as unknown as Record<string, unknown>).cashBalanceMinor = '100'; }), 'WRONG_TYPE', 'cashBalanceMinor'],
  ['negative cash', mutate((i) => { i.cashBalanceMinor = -1; }), 'OUT_OF_RANGE', 'cashBalanceMinor'],
  ['cash above MAX_MINOR', mutate((i) => { i.cashBalanceMinor = MAX_MINOR + 1; }), 'OUT_OF_RANGE', 'cashBalanceMinor'],
  ['negative MRR', mutate((i) => { i.monthlyRecurringRevenueMinor = -1; }), 'OUT_OF_RANGE', 'monthlyRecurringRevenueMinor'],
  ['negative burn', mutate((i) => { i.existingMonthlyBurnMinor = -1; }), 'OUT_OF_RANGE', 'existingMonthlyBurnMinor'],
  ['lower-case currency', mutate((i) => { i.currency = 'usd'; }), 'INVALID_CURRENCY', 'currency'],
  ['2-letter currency', mutate((i) => { i.currency = 'US'; }), 'INVALID_CURRENCY', 'currency'],
  ['numeric currency', mutate((i) => { (i as unknown as Record<string, unknown>).currency = 840; }), 'INVALID_CURRENCY', 'currency'],
  ['bad start month (13)', mutate((i) => { i.startMonth = '2026-13'; }), 'INVALID_MONTH', 'startMonth'],
  ['bad start month format', mutate((i) => { i.startMonth = '2026-1'; }), 'INVALID_MONTH', 'startMonth'],
  ['horizon 0', mutate((i) => { i.horizonMonths = 0; }), 'OUT_OF_RANGE', 'horizonMonths'],
  ['horizon 121', mutate((i) => { i.horizonMonths = 121; }), 'OUT_OF_RANGE', 'horizonMonths'],
  ['horizon 1.5', mutate((i) => { i.horizonMonths = 1.5; }), 'NOT_INTEGER', 'horizonMonths'],
  ['decimals 19', mutate((i) => { i.minorUnitDecimals = 19; }), 'OUT_OF_RANGE', 'minorUnitDecimals'],
  ['existingObligations not array', mutate((i) => { (i as unknown as Record<string, unknown>).existingObligations = {}; }), 'WRONG_TYPE', 'existingObligations'],
  ['obligation not an object', mutate((i) => { (i.proposedObligations as unknown[])[0] = 5; }), 'WRONG_TYPE', 'proposedObligations[0]'],
  ['duplicate id across lists', mutate((i) => { i.proposedObligations[0]!.id = i.existingObligations[0]!.id; }), 'DUPLICATE_ID', 'proposedObligations[0].id'],
  ['bad id characters', mutate((i) => { i.proposedObligations[0]!.id = 'has space'; }), 'INVALID_ID', 'proposedObligations[0].id'],
  ['empty id', mutate((i) => { i.proposedObligations[0]!.id = ''; }), 'INVALID_ID', 'proposedObligations[0].id'],
  ['blank label', mutate((i) => { i.proposedObligations[0]!.label = '   '; }), 'OUT_OF_RANGE', 'proposedObligations[0].label'],
  ['obligation amount 0', mutate((i) => { i.proposedObligations[0]!.amountMinor = 0; }), 'OUT_OF_RANGE', 'proposedObligations[0].amountMinor'],
  ['obligation amount float', mutate((i) => { i.proposedObligations[0]!.amountMinor = 99.99; }), 'NOT_INTEGER', 'proposedObligations[0].amountMinor'],
  ['bad cadence', mutate((i) => { (i.proposedObligations[0] as unknown as Record<string, unknown>).cadence = 'weekly'; }), 'INVALID_ENUM', 'proposedObligations[0].cadence'],
  ['bad timing', mutate((i) => { (i.proposedObligations[0] as unknown as Record<string, unknown>).paymentTiming = 'middle'; }), 'INVALID_ENUM', 'proposedObligations[0].paymentTiming'],
  ['bad term start', mutate((i) => { i.proposedObligations[0]!.termStartMonth = '2027-00'; }), 'INVALID_MONTH', 'proposedObligations[0].termStartMonth'],
  ['term 0', mutate((i) => { i.proposedObligations[0]!.termMonths = 0; }), 'OUT_OF_RANGE', 'proposedObligations[0].termMonths'],
  ['term 121', mutate((i) => { i.proposedObligations[0]!.termMonths = 121; }), 'OUT_OF_RANGE', 'proposedObligations[0].termMonths'],
  ['quarterly term 10', mutate((i) => { Object.assign(i.proposedObligations[0]!, { cadence: 'quarterly', termMonths: 10 }); }), 'TERM_NOT_MULTIPLE_OF_CADENCE', 'proposedObligations[0].termMonths'],
  ['annual term 18', mutate((i) => { Object.assign(i.proposedObligations[0]!, { cadence: 'annual', termMonths: 18 }); }), 'TERM_NOT_MULTIPLE_OF_CADENCE', 'proposedObligations[0].termMonths'],
  ['cap below amount', mutate((i) => { i.proposedObligations[0]!.periodicCapMinor = 2_499_999; }), 'CAP_BELOW_AMOUNT', 'proposedObligations[0].periodicCapMinor'],
  ['cap zero', mutate((i) => { i.proposedObligations[0]!.periodicCapMinor = 0; }), 'OUT_OF_RANGE', 'proposedObligations[0].periodicCapMinor'],
  ['notice 37', mutate((i) => { i.proposedObligations[0]!.terminationNoticeMonths = 37; }), 'OUT_OF_RANGE', 'proposedObligations[0].terminationNoticeMonths'],
  ['notice negative', mutate((i) => { i.proposedObligations[0]!.terminationNoticeMonths = -1; }), 'OUT_OF_RANGE', 'proposedObligations[0].terminationNoticeMonths'],
  ['unknown obligation field', mutate((i) => { Object.assign(i.proposedObligations[0]!, { amount: 5 }); }), 'UNKNOWN_FIELD', 'proposedObligations[0].amount'],
  ['renewal not object', mutate((i) => { (i.proposedObligations[0] as unknown as Record<string, unknown>).renewal = 'yes'; }), 'WRONG_TYPE', 'proposedObligations[0].renewal'],
  ['renewal missing autoRenews', mutate((i) => { delete (i.proposedObligations[0]!.renewal as unknown as Record<string, unknown>).autoRenews; }), 'MISSING_FIELD', 'proposedObligations[0].renewal.autoRenews'],
  ['renewal uplift too low', mutate((i) => { i.proposedObligations[0]!.renewal!.renewalAmountChangeBps = -5_001; }), 'OUT_OF_RANGE', 'proposedObligations[0].renewal.renewalAmountChangeBps'],
  ['renewal uplift too high', mutate((i) => { i.proposedObligations[0]!.renewal!.renewalAmountChangeBps = 10_001; }), 'OUT_OF_RANGE', 'proposedObligations[0].renewal.renewalAmountChangeBps'],
  ['renewal term mismatch', mutate((i) => { Object.assign(i.proposedObligations[0]!, { cadence: 'quarterly' }); i.proposedObligations[0]!.renewal!.renewalTermMonths = 5; }), 'RENEWAL_TERM_NOT_MULTIPLE_OF_CADENCE', 'proposedObligations[0].renewal.renewalTermMonths'],
  ['one_time cannot auto-renew', mutate((i) => { Object.assign(i.proposedObligations[0]!, { cadence: 'one_time' }); }), 'ONE_TIME_CANNOT_RENEW', 'proposedObligations[0].renewal'],
  ['missing policy', mutate((i) => { delete (i as unknown as Record<string, unknown>).policy; }), 'MISSING_FIELD', 'policy'],
  ['negative reserve', mutate((i) => { i.policy.minimumCashReserveMinor = -1; }), 'OUT_OF_RANGE', 'policy.minimumCashReserveMinor'],
  ['runway policy 121', mutate((i) => { i.policy.minimumRunwayMonths = 121; }), 'OUT_OF_RANGE', 'policy.minimumRunwayMonths'],
  ['large payment bps 10001', mutate((i) => { i.policy.largePaymentShareBps = 10_001; }), 'OUT_OF_RANGE', 'policy.largePaymentShareBps'],
  ['unknown policy field', mutate((i) => { Object.assign(i.policy, { reserve: 1 }); }), 'UNKNOWN_FIELD', 'policy.reserve'],
  ['missing baseAssumptions', mutate((i) => { delete (i as unknown as Record<string, unknown>).baseAssumptions; }), 'MISSING_FIELD', 'baseAssumptions'],
  ['assumptions not object', mutate((i) => { (i as unknown as Record<string, unknown>).baseAssumptions = 5; }), 'WRONG_TYPE', 'baseAssumptions'],
  ['assumption field missing', mutate((i) => { delete (i.baseAssumptions as unknown as Record<string, unknown>).renewalsEnabled; }), 'MISSING_FIELD', 'baseAssumptions.renewalsEnabled'],
  ['revenue below -100%', mutate((i) => { i.baseAssumptions.revenueChangeBps = -10_001; }), 'OUT_OF_RANGE', 'baseAssumptions.revenueChangeBps'],
  ['revenue above +1000%', mutate((i) => { i.baseAssumptions.revenueChangeBps = 100_001; }), 'OUT_OF_RANGE', 'baseAssumptions.revenueChangeBps'],
  ['usage below 1x', mutate((i) => { i.baseAssumptions.usageMultiplierBps = 9_999; }), 'OUT_OF_RANGE', 'baseAssumptions.usageMultiplierBps'],
  ['usage above 10x', mutate((i) => { i.baseAssumptions.usageMultiplierBps = 100_001; }), 'OUT_OF_RANGE', 'baseAssumptions.usageMultiplierBps'],
  ['delay 13 months', mutate((i) => { i.baseAssumptions.customerPaymentDelayMonths = 13; }), 'OUT_OF_RANGE', 'baseAssumptions.customerPaymentDelayMonths'],
  ['delay negative', mutate((i) => { i.baseAssumptions.customerPaymentDelayMonths = -1; }), 'OUT_OF_RANGE', 'baseAssumptions.customerPaymentDelayMonths'],
  ['delayed share 10001', mutate((i) => { i.baseAssumptions.delayedRevenueShareBps = 10_001; }), 'OUT_OF_RANGE', 'baseAssumptions.delayedRevenueShareBps'],
  ['renewalsEnabled string', mutate((i) => { (i.baseAssumptions as unknown as Record<string, unknown>).renewalsEnabled = 'true'; }), 'WRONG_TYPE', 'baseAssumptions.renewalsEnabled'],
  ['preset downside positive', mutate((i) => { i.presetParameters = { downsideRevenueBps: 1 }; }), 'OUT_OF_RANGE', 'presetParameters.downsideRevenueBps'],
  ['preset delay 0', mutate((i) => { i.presetParameters = { delayMonths: 0 }; }), 'OUT_OF_RANGE', 'presetParameters.delayMonths'],
  ['preset usage 0.9x', mutate((i) => { i.presetParameters = { highUsageMultiplierBps: 9_000 }; }), 'OUT_OF_RANGE', 'presetParameters.highUsageMultiplierBps'],
  ['preset unknown key', mutate((i) => { (i as unknown as Record<string, unknown>).presetParameters = { foo: 1 }; }), 'UNKNOWN_FIELD', 'presetParameters.foo'],
  ['extra scenario reserved id', mutate((i) => { i.extraScenarios = [{ id: 'base', label: 'x', assumptions: i.baseAssumptions }]; }), 'DUPLICATE_ID', 'extraScenarios[0].id'],
  ['extra scenario duplicate ids', mutate((i) => { i.extraScenarios = [{ id: 'a', label: 'x', assumptions: i.baseAssumptions }, { id: 'a', label: 'y', assumptions: i.baseAssumptions }]; }), 'DUPLICATE_ID', 'extraScenarios[1].id'],
  ['extra scenario incomplete assumptions', mutate((i) => { (i as unknown as Record<string, unknown>).extraScenarios = [{ id: 'a', label: 'x', assumptions: { revenueChangeBps: 0 } }]; }), 'MISSING_FIELD', 'extraScenarios[0].assumptions.usageMultiplierBps'],
  ['extra scenarios not array', mutate((i) => { (i as unknown as Record<string, unknown>).extraScenarios = {}; }), 'WRONG_TYPE', 'extraScenarios'],
];

for (const [name, input, code, path] of cases) {
  test(`rejects: ${name}`, () => {
    const errs = errorsOf(input);
    assert.ok(
      errs.some((e) => e.code === code && e.path === path),
      `expected ${code} at "${path}", got ${JSON.stringify(errs)}`,
    );
  });
}

test('every required top-level field produces MISSING_FIELD when absent', () => {
  for (const key of ['currency', 'startMonth', 'horizonMonths', 'cashBalanceMinor', 'monthlyRecurringRevenueMinor', 'existingMonthlyBurnMinor', 'existingObligations', 'proposedObligations', 'baseAssumptions', 'policy']) {
    const i = goldenDemoInput() as unknown as Record<string, unknown>;
    delete i[key];
    assert.ok(errorsOf(i).some((e) => e.code === 'MISSING_FIELD' && e.path === key), key);
  }
});

test('every required obligation field produces MISSING_FIELD when absent', () => {
  for (const key of ['id', 'label', 'counterparty', 'amountMinor', 'cadence', 'termStartMonth', 'termMonths', 'paymentTiming', 'usageSensitive', 'terminationNoticeMonths']) {
    const i = goldenDemoInput();
    delete (i.proposedObligations[0] as unknown as Record<string, unknown>)[key];
    assert.ok(errorsOf(i).some((e) => e.code === 'MISSING_FIELD' && e.path === `proposedObligations[0].${key}`), key);
  }
});

test('multiple problems are all reported at once', () => {
  const errs = errorsOf(mutate((i) => { i.cashBalanceMinor = -5; i.horizonMonths = 0; i.currency = 'x'; i.startMonth = 'nope'; }));
  const paths = errs.map((e) => e.path);
  for (const p of ['cashBalanceMinor', 'horizonMonths', 'currency', 'startMonth']) assert.ok(paths.includes(p), p);
});

test('error messages are non-empty strings', () => {
  for (const e of errorsOf(null)) assert.ok(typeof e.message === 'string' && e.message.length > 0);
});

test('too many obligations is rejected', () => {
  const list = Array.from({ length: 501 }, (_, k) => ob({ id: `o${k}` }));
  assert.ok(errorsOf(small((i) => { i.existingObligations = list; })).some((e) => e.code === 'TOO_MANY_OBLIGATIONS'));
});

test('validation never throws on hostile values', () => {
  const hostile: unknown[] = [Symbol.iterator.toString(), () => 1, { toString: () => 'x' }, new Date(0), 1n === 1n, -0, [[]], { __proto__: { a: 1 } }];
  for (const h of hostile) {
    assert.doesNotThrow(() => validateTwinInput(h));
    assert.doesNotThrow(() => runTwin({ ...goldenDemoInput(), cashBalanceMinor: h }));
  }
});

/* ---- accepted boundaries ---- */

test('accepts boundary values', () => {
  const o = run(small((i) => {
    i.horizonMonths = 1;
    i.cashBalanceMinor = 0;
    i.baseAssumptions.revenueChangeBps = -10_000;
    i.baseAssumptions.usageMultiplierBps = 100_000;
    i.baseAssumptions.customerPaymentDelayMonths = 12;
    i.baseAssumptions.delayedRevenueShareBps = 0;
  }));
  assert.equal(o.horizonMonths, 1);
  assert.equal(run(small((i) => { i.horizonMonths = 120; })).scenarios[0]!.timeline.after.length, 120);
  assert.doesNotThrow(() => run(small((i) => { i.cashBalanceMinor = MAX_MINOR; })));
  assert.doesNotThrow(() => run(small((i) => { i.startMonth = '2000-01'; })));
  assert.doesNotThrow(() => run(small((i) => { i.startMonth = '2200-01'; i.horizonMonths = 12; })));
});

test('optional fields default and are echoed in assumptionsUsed', () => {
  const o = run(goldenDemoInput());
  assert.equal(o.assumptionsUsed.policy.largePaymentShareBps, 2_500);
  assert.deepEqual(o.assumptionsUsed.presetParameters, { downsideRevenueBps: -2_000, upsideRevenueBps: 2_000, highUsageMultiplierBps: 15_000, delayMonths: 2 });
  const o2 = run(small());
  assert.equal(o2.assumptionsUsed.minorUnitDecimals, 2);
  assert.deepEqual(o2.assumptionsUsed.extraScenarios, []);
});

test('null optional obligation fields are accepted', () => {
  const o = run(small((i) => { i.existingObligations = [ob({ periodicCapMinor: null, renewal: null, externalRef: null })]; }));
  assert.equal(o.assumptionsUsed.existingObligations[0]!.periodicCapMinor, null);
});

test('an obligation with renewal.autoRenews=false is valid for one_time', () => {
  assert.doesNotThrow(() => run(small((i) => {
    i.existingObligations = [ob({ cadence: 'one_time', renewal: { autoRenews: false, renewalTermMonths: 1, renewalAmountChangeBps: 0 } })];
  })));
});
