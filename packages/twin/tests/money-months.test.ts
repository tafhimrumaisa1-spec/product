import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MoneyError, add, sub, sum, mulDivRound, divRound, floorHundredths, exceedsShare, applyBps, MAX_MINOR } from '../src/advanced/money';
import { parseMonth, formatMonth, cadenceMonths } from '../src/advanced/months';

test('mulDivRound rounds half away from zero', () => {
  assert.equal(mulDivRound(5, 1, 2), 3); // 2.5 -> 3
  assert.equal(mulDivRound(-5, 1, 2), -3); // -2.5 -> -3
  assert.equal(mulDivRound(4, 1, 3), 1); // 1.33 -> 1
  assert.equal(mulDivRound(5, 1, 3), 2); // 1.67 -> 2
  assert.equal(mulDivRound(1, 1, 2), 1);
  assert.equal(mulDivRound(0, 12345, 7), 0);
  assert.equal(divRound(7, 2), 4);
  assert.equal(divRound(-7, 2), -4);
});

test('mulDivRound is exact beyond 2^53 intermediate products', () => {
  // 9e15 * 9e15 would be inexact as a float; BigInt keeps it exact: result 9e15 * 1 / 1
  assert.equal(mulDivRound(9_000_000_000_000_000, 9_000_000_000_000_000, 9_000_000_000_000_000), 9_000_000_000_000_000);
  assert.equal(mulDivRound(MAX_MINOR, 10_000, 10_000), MAX_MINOR);
});

test('mulDivRound rejects non-integers, bad divisors and overflow', () => {
  assert.throws(() => mulDivRound(1.5, 1, 1), MoneyError);
  assert.throws(() => mulDivRound(1, 1, 0), MoneyError);
  assert.throws(() => mulDivRound(1, 1, -3), MoneyError);
  assert.throws(() => mulDivRound(Number.NaN, 1, 1), MoneyError);
  assert.throws(() => mulDivRound(Number.MAX_SAFE_INTEGER, 2, 1), MoneyError);
});

test('add/sub/sum guard the safe-integer range', () => {
  assert.equal(add(2, 3), 5);
  assert.equal(sub(2, 3), -1);
  assert.equal(sum([]), 0);
  assert.equal(sum([1, 2, 3]), 6);
  assert.throws(() => add(Number.MAX_SAFE_INTEGER, 1), MoneyError);
  assert.throws(() => sub(Number.MIN_SAFE_INTEGER, 1), MoneyError);
  assert.throws(() => sum([Number.MAX_SAFE_INTEGER, 1]), MoneyError);
  assert.throws(() => sum([0.5]), MoneyError);
  assert.throws(() => add(Infinity, 1), MoneyError);
});

test('floorHundredths floors and validates', () => {
  assert.equal(floorHundredths(1, 3), 33);
  assert.equal(floorHundredths(2, 3), 66);
  assert.equal(floorHundredths(0, 5), 0);
  assert.equal(floorHundredths(5, 5), 100);
  assert.throws(() => floorHundredths(-1, 5), MoneyError);
  assert.throws(() => floorHundredths(1, 0), MoneyError);
});

test('exceedsShare is exact at the boundary', () => {
  assert.equal(exceedsShare(250, 1000, 2_500), false); // exactly 25%
  assert.equal(exceedsShare(251, 1000, 2_500), true);
  assert.equal(exceedsShare(1, 0, 2_500), true);
  assert.equal(exceedsShare(0, 0, 2_500), false);
  assert.equal(exceedsShare(MAX_MINOR, MAX_MINOR, 10_000), false);
});

test('applyBps', () => {
  assert.equal(applyBps(1_000, 500), 1_050);
  assert.equal(applyBps(1_050, 500), 1_103); // 1102.5 rounds up
  assert.equal(applyBps(1_000, -10_000), 0);
  assert.equal(applyBps(1_000, -2_000), 800);
});

test('parseMonth / formatMonth boundaries', () => {
  assert.equal(parseMonth('2000-01'), 2000 * 12);
  assert.equal(parseMonth('2200-12'), 2200 * 12 + 11);
  for (const bad of ['1999-12', '2201-01', '2026-00', '2026-13', '2026-1', '26-01', '2026/01', ' 2026-01', '2026-01-01', '', 'abc']) {
    assert.equal(parseMonth(bad), null, bad);
  }
  assert.equal(parseMonth(202601), null);
  assert.equal(parseMonth(null), null);
  assert.equal(formatMonth(parseMonth('2026-12') as number), '2026-12');
  assert.equal(formatMonth((parseMonth('2026-12') as number) + 1), '2027-01');
  assert.equal(formatMonth((parseMonth('2026-01') as number) - 1), '2025-12');
});

test('cadenceMonths', () => {
  assert.equal(cadenceMonths('monthly', 7), 1);
  assert.equal(cadenceMonths('quarterly', 6), 3);
  assert.equal(cadenceMonths('semi_annual', 12), 6);
  assert.equal(cadenceMonths('annual', 24), 12);
  assert.equal(cadenceMonths('one_time', 9), 9);
});
