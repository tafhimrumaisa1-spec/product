import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialTermPayments, paymentsInWindow, nextRenewalStart } from '../src/advanced/schedule';
import { parseMonth } from '../src/advanced/months';
import type { NormalizedObligation, ScenarioAssumptions } from '../src/advanced';
import { ob } from './helpers';

const A: ScenarioAssumptions = { revenueChangeBps: 0, usageMultiplierBps: 10_000, renewalsEnabled: true, customerPaymentDelayMonths: 0, delayedRevenueShareBps: 10_000 };
const norm = (o: ReturnType<typeof ob>): NormalizedObligation => ({
  ...o, periodicCapMinor: o.periodicCapMinor ?? null, renewal: o.renewal ?? null, externalRef: o.externalRef ?? null,
});
const m = (s: string): number => parseMonth(s) as number;
const months = (o: NormalizedObligation, start: string, end: string, a = A) =>
  paymentsInWindow(o, 'existing', m(start), m(end), a).map((e) => e.month);

test('monthly advance: payments at the start of each month', () => {
  const o = norm(ob({ termStartMonth: '2026-01', termMonths: 3 }));
  assert.deepEqual(initialTermPayments(o).map((p) => p.monthIndex - m('2026-01')), [0, 1, 2]);
});

test('quarterly advance vs arrears', () => {
  const adv = norm(ob({ cadence: 'quarterly', termMonths: 12, paymentTiming: 'advance' }));
  const arr = norm(ob({ cadence: 'quarterly', termMonths: 12, paymentTiming: 'arrears' }));
  const off = (o: NormalizedObligation) => initialTermPayments(o).map((p) => p.monthIndex - m('2026-01'));
  assert.deepEqual(off(adv), [0, 3, 6, 9]);
  assert.deepEqual(off(arr), [2, 5, 8, 11]);
});

test('annual and semi-annual cadence', () => {
  const an = norm(ob({ cadence: 'annual', termMonths: 24 }));
  assert.deepEqual(initialTermPayments(an).map((p) => p.monthIndex - m('2026-01')), [0, 12]);
  const sa = norm(ob({ cadence: 'semi_annual', termMonths: 12, paymentTiming: 'arrears' }));
  assert.deepEqual(initialTermPayments(sa).map((p) => p.monthIndex - m('2026-01')), [5, 11]);
});

test('one_time pays once: at start (advance) or at term end (arrears)', () => {
  const adv = norm(ob({ cadence: 'one_time', termMonths: 6, paymentTiming: 'advance' }));
  const arr = norm(ob({ cadence: 'one_time', termMonths: 6, paymentTiming: 'arrears' }));
  assert.deepEqual(initialTermPayments(adv).map((p) => p.monthIndex - m('2026-01')), [0]);
  assert.deepEqual(initialTermPayments(arr).map((p) => p.monthIndex - m('2026-01')), [5]);
});

test('term of 1 month works for every non-one_time cadence that divides it', () => {
  const o = norm(ob({ cadence: 'monthly', termMonths: 1 }));
  assert.equal(initialTermPayments(o).length, 1);
});

test('payments before the window are skipped; offsets are relative to window start', () => {
  const o = norm(ob({ termStartMonth: '2025-10', termMonths: 6 })); // 2025-10..2026-03
  const ev = paymentsInWindow(o, 'existing', m('2026-01'), m('2026-03'), A);
  assert.deepEqual(ev.map((e) => [e.month, e.monthOffset]), [['2026-01', 0], ['2026-02', 1]]);
});

test('window is half-open [start, end)', () => {
  const o = norm(ob({ termMonths: 12 }));
  assert.deepEqual(months(o, '2026-03', '2026-05'), ['2026-03', '2026-04']);
  assert.deepEqual(months(o, '2026-03', '2026-03'), []);
});

test('contract starting after the window produces nothing', () => {
  const o = norm(ob({ termStartMonth: '2030-01' }));
  assert.deepEqual(months(o, '2026-01', '2027-01'), []);
});

test('renewals continue while enabled and auto-renewing, with compounding price change', () => {
  const o = norm(ob({ amountMinor: 1_000, termMonths: 12, renewal: { autoRenews: true, renewalTermMonths: 12, renewalAmountChangeBps: 500 } }));
  const ev = paymentsInWindow(o, 'existing', m('2026-01'), m('2028-12') + 1, A);
  const at = (mo: string) => ev.find((e) => e.month === mo)!;
  assert.equal(at('2026-12').amountMinor, 1_000);
  assert.equal(at('2026-12').phase, 'initial_term');
  assert.equal(at('2027-01').amountMinor, 1_050);
  assert.equal(at('2027-01').phase, 'renewal');
  assert.equal(at('2027-01').renewalCycle, 1);
  assert.equal(at('2028-01').amountMinor, 1_103); // 1050 * 1.05 = 1102.5 -> 1103
  assert.equal(at('2028-01').renewalCycle, 2);
  assert.equal(ev.length, 36);
});

test('renewals off or autoRenews=false: payments stop at the end of the initial term', () => {
  const on = norm(ob({ termMonths: 6, renewal: { autoRenews: true, renewalTermMonths: 6, renewalAmountChangeBps: 0 } }));
  assert.equal(paymentsInWindow(on, 'existing', m('2026-01'), m('2027-01'), { ...A, renewalsEnabled: false }).length, 6);
  assert.equal(paymentsInWindow(on, 'existing', m('2026-01'), m('2027-01'), A).length, 12);
  const never = norm(ob({ termMonths: 6, renewal: { autoRenews: false, renewalTermMonths: 6, renewalAmountChangeBps: 0 } }));
  assert.equal(paymentsInWindow(never, 'existing', m('2026-01'), m('2027-01'), A).length, 6);
});

test('renewal term can differ from the initial term and uses the same cadence', () => {
  const o = norm(ob({ cadence: 'quarterly', termMonths: 12, renewal: { autoRenews: true, renewalTermMonths: 6, renewalAmountChangeBps: 0 } }));
  const ev = paymentsInWindow(o, 'existing', m('2026-01'), m('2028-01'), A);
  assert.deepEqual(ev.map((e) => e.monthOffset), [0, 3, 6, 9, 12, 15, 18, 21]);
});

test('negative renewal price change and -100%-ish bound', () => {
  const o = norm(ob({ amountMinor: 1_000, termMonths: 1, renewal: { autoRenews: true, renewalTermMonths: 1, renewalAmountChangeBps: -5_000 } }));
  const ev = paymentsInWindow(o, 'existing', m('2026-01'), m('2026-05'), A);
  assert.deepEqual(ev.map((e) => e.amountMinor), [1_000, 500, 250, 125]);
});

test('usage scaling applies only to usage-sensitive obligations and never below base', () => {
  const plain = norm(ob({ usageSensitive: false, termMonths: 1 }));
  const usage = norm(ob({ usageSensitive: true, termMonths: 1 }));
  const a2 = { ...A, usageMultiplierBps: 20_000 };
  assert.equal(paymentsInWindow(plain, 'existing', m('2026-01'), m('2026-02'), a2)[0]!.amountMinor, 1_000);
  const u = paymentsInWindow(usage, 'existing', m('2026-01'), m('2026-02'), a2)[0]!;
  assert.equal(u.amountMinor, 2_000);
  assert.equal(u.usageScaled, true);
  const u1 = paymentsInWindow(usage, 'existing', m('2026-01'), m('2026-02'), A)[0]!;
  assert.equal(u1.amountMinor, 1_000);
  assert.equal(u1.usageScaled, false);
});

test('periodic cap limits usage scaling exactly at and above the boundary', () => {
  const o = norm(ob({ usageSensitive: true, termMonths: 1, amountMinor: 10_000, periodicCapMinor: 15_000 }));
  const at = (bps: number) => paymentsInWindow(o, 'existing', m('2026-01'), m('2026-02'), { ...A, usageMultiplierBps: bps })[0]!;
  assert.deepEqual([at(14_999).amountMinor, at(14_999).capped], [14_999, false]);
  assert.deepEqual([at(15_000).amountMinor, at(15_000).capped], [15_000, false]); // exactly the cap
  assert.deepEqual([at(15_001).amountMinor, at(15_001).capped], [15_000, true]); // one bp above
});

test('cap binds when scaled amount is clearly above it', () => {
  const o = norm(ob({ usageSensitive: true, termMonths: 1, amountMinor: 1_000, periodicCapMinor: 1_500 }));
  const e = paymentsInWindow(o, 'existing', m('2026-01'), m('2026-02'), { ...A, usageMultiplierBps: 30_000 })[0]!;
  assert.equal(e.amountMinor, 1_500);
  assert.equal(e.capped, true);
  assert.equal(e.usageScaled, true);
});

test('cap does not reduce a renewal base that already exceeds the cap', () => {
  const o = norm(ob({ usageSensitive: true, termMonths: 1, amountMinor: 1_000, periodicCapMinor: 1_000, renewal: { autoRenews: true, renewalTermMonths: 1, renewalAmountChangeBps: 1_000 } }));
  const ev = paymentsInWindow(o, 'existing', m('2026-01'), m('2026-03'), { ...A, usageMultiplierBps: 20_000 });
  assert.deepEqual(ev.map((e) => e.amountMinor), [1_000, 1_100]); // base wins over cap; never below base
  assert.deepEqual(ev.map((e) => e.capped), [true, true]); // scaling was limited by the cap, result = base
});

test('nextRenewalStart', () => {
  const o = norm(ob({ termStartMonth: '2026-01', termMonths: 12, renewal: { autoRenews: true, renewalTermMonths: 12, renewalAmountChangeBps: 0 } }));
  assert.equal(nextRenewalStart(o, m('2026-06')), m('2027-01'));
  assert.equal(nextRenewalStart(o, m('2027-01')), m('2027-01'));
  assert.equal(nextRenewalStart(o, m('2027-02')), m('2028-01'));
  assert.equal(nextRenewalStart(norm(ob()), m('2026-01')), null);
  assert.equal(nextRenewalStart(norm(ob({ renewal: { autoRenews: false, renewalTermMonths: 1, renewalAmountChangeBps: 0 } })), m('2026-01')), null);
});
