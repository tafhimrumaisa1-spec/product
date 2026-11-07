import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractWithRules } from '../src/extract/rules.js';
import { parseAmountToMinor, formatMoney, wholeMonthsInclusive, addMonthsIso, parseIsoDate } from '../src/money.js';
import { sessionIssues } from '../src/review.js';
import { SYNTHETIC_COMPUTE_CONTRACT } from '../src/fixtures/syntheticComputeContract.js';
import { freshSession } from './helpers.js';

test('rules extractor finds all seven golden-demo obligations', () => {
  const p = extractWithRules(SYNTHETIC_COMPUTE_CONTRACT);
  assert.deepEqual(
    p.obligations.map((o) => o.terms.kind),
    ['PARTIES', 'TOTAL_VALUE', 'PERIODIC_CAP', 'TERM', 'PAYMENT_SCHEDULE', 'RENEWAL', 'TERMINATION'],
  );
});

test('extracted values match the fixture contract', () => {
  const p = extractWithRules(SYNTHETIC_COMPUTE_CONTRACT);
  const by = (k: string) => p.obligations.find((o) => o.terms.kind === k)?.terms;
  assert.deepEqual(by('PARTIES'), { kind: 'PARTIES', vendor: 'Meridian Compute Ltd.', customer: 'Halcyon Robotics Inc.' });
  assert.deepEqual(by('TOTAL_VALUE'), { kind: 'TOTAL_VALUE', total: { amountMinor: 6_000_000, currency: 'USD' } });
  assert.deepEqual(by('PERIODIC_CAP'), { kind: 'PERIODIC_CAP', cap: { amountMinor: 1_200_000, currency: 'USD' }, period: 'MONTH' });
  assert.deepEqual(by('TERM'), { kind: 'TERM', startDate: '2026-01-01', endDate: '2026-06-30', durationMonths: 6 });
  assert.deepEqual(by('RENEWAL'), { kind: 'RENEWAL', autoRenew: true, renewalTermMonths: 6, nonRenewalNoticeDays: 30 });
  assert.deepEqual(by('TERMINATION'), { kind: 'TERMINATION', forConvenience: true, noticeDays: 60 });
  const sched = by('PAYMENT_SCHEDULE');
  assert.equal(sched?.kind, 'PAYMENT_SCHEDULE');
  if (sched?.kind === 'PAYMENT_SCHEDULE') {
    assert.deepEqual(sched.installments.map((i) => i.dueDate), [
      '2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01',
    ]);
    assert.ok(sched.installments.every((i) => i.amount.amountMinor === 1_000_000));
  }
});

test('every evidence quote equals the document slice and the fixture has zero blocking issues', () => {
  const s = freshSession();
  for (const o of s.obligations) {
    for (const e of o.evidence) assert.equal(SYNTHETIC_COMPUTE_CONTRACT.text.slice(e.start, e.end), e.quote);
  }
  assert.deepEqual(sessionIssues(s).filter((i) => i.severity === 'error'), []);
});

test('extraction is deterministic', () => {
  assert.deepEqual(extractWithRules(SYNTHETIC_COMPUTE_CONTRACT), extractWithRules(SYNTHETIC_COMPUTE_CONTRACT));
});

test('a contract with no recognizable terms yields no obligations (nothing invented)', () => {
  const p = extractWithRules({ contractId: 'X', text: 'Hello world. Nothing to see.' });
  assert.equal(p.obligations.length, 0);
});

test('money parsing uses integers and rejects malformed amounts', () => {
  assert.equal(parseAmountToMinor('60,000.00'), 6_000_000);
  assert.equal(parseAmountToMinor('0.10'), 10);
  assert.equal(parseAmountToMinor('12.5'), 1250);
  assert.equal(parseAmountToMinor('1,00'), null);
  assert.equal(parseAmountToMinor('abc'), null);
  assert.equal(formatMoney({ amountMinor: 6_000_005, currency: 'USD' }), 'USD 60,000.05');
});

test('date helpers', () => {
  assert.equal(wholeMonthsInclusive('2026-01-01', '2026-06-30'), 6);
  assert.equal(wholeMonthsInclusive('2026-01-01', '2026-06-29'), null);
  assert.equal(addMonthsIso('2026-01-31', 1), '2026-02-28');
  assert.equal(parseIsoDate('2026-02-30'), null);
});
