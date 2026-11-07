import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCommitment, generateSalt, verifyCommitment } from '../src/commitment.js';
import { finalizeReview } from '../src/review.js';
import { toCashflows, toMandateTerms } from '../src/projection.js';
import { canonicalJson } from '../src/canonical.js';
import { FIXTURE_SALT_HEX } from '../src/fixtures/syntheticComputeContract.js';
import { AT, HUMAN, approveAll, freshSession, unwrap } from './helpers.js';

const finalized = () => unwrap(finalizeReview(approveAll(freshSession()), HUMAN, AT, FIXTURE_SALT_HEX)).approved;

test('commitment is deterministic for the same terms and salt', () => {
  assert.equal(finalized().commitment.value, finalized().commitment.value);
  assert.match(finalized().commitment.value, /^[0-9a-f]{64}$/);
});

test('commitment verifies with the right salt and fails with a wrong one or altered terms', () => {
  const a = finalized();
  assert.equal(verifyCommitment(a, FIXTURE_SALT_HEX), true);
  assert.equal(verifyCommitment(a, 'ff'.repeat(32)), false);
  const altered = {
    ...a,
    obligations: a.obligations.map((o) =>
      o.terms.kind === 'TOTAL_VALUE' ? { ...o, terms: { kind: 'TOTAL_VALUE' as const, total: { amountMinor: 1, currency: 'USD' } } } : o,
    ),
  };
  assert.equal(verifyCommitment(altered, FIXTURE_SALT_HEX), false);
});

test('different salts give unlinkable commitments', () => {
  const a = finalized();
  const other = computeCommitment(a.contractId, a.documentSha256, a.obligations, generateSalt());
  assert.equal(other.ok && other.value.value !== a.commitment.value, true);
});

test('invalid salts are rejected at finalize and commit time', () => {
  const s = approveAll(freshSession());
  const r = finalizeReview(s, HUMAN, AT, 'short');
  assert.equal(!r.ok && r.error.code, 'INVALID_SALT');
  const c = computeCommitment('x', 'y', [], 'zz');
  assert.equal(!c.ok && c.error.code, 'INVALID_SALT');
});

test('approved set and commitment do not contain the salt or contract prose', () => {
  const json = JSON.stringify(finalized());
  assert.equal(json.includes(FIXTURE_SALT_HEX), false);
  assert.equal(json.includes('GPU compute capacity'), false);
});

test('generateSalt returns 64 hex chars and is not constant', () => {
  const a = generateSalt();
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, generateSalt());
});

test('toMandateTerms projects exactly what FluxMandate needs', () => {
  const m = unwrap(toMandateTerms(finalized()));
  assert.deepEqual(
    { ...m, commitment: 'x' },
    {
      contractId: 'FX-SYN-2026-0001',
      commitment: 'x',
      vendorName: 'Meridian Compute Ltd.',
      customerName: 'Halcyon Robotics Inc.',
      currency: 'USD',
      totalCapMinor: 6_000_000,
      periodCapMinor: 1_200_000,
      period: 'MONTH',
      validFrom: '2026-01-01',
      validTo: '2026-06-30',
      autoRenewalExtendsMandate: false,
      terminationNoticeDays: 60,
    },
  );
});

test('toCashflows yields six ordered USD 10,000 outflows summing to the total', () => {
  const flows = unwrap(toCashflows(finalized()));
  assert.equal(flows.length, 6);
  assert.equal(flows.reduce((a, f) => a + f.amountMinor, 0), 6_000_000);
  assert.deepEqual(flows.map((f) => f.date), [...flows.map((f) => f.date)].sort());
});

test('projections fail cleanly on an incomplete set', () => {
  const partial = { ...finalized(), obligations: [] };
  const m = toMandateTerms(partial);
  const c = toCashflows(partial);
  assert.equal(!m.ok && m.error.code, 'MISSING_REQUIRED');
  assert.equal(!c.ok && c.error.code, 'MISSING_REQUIRED');
});

test('canonicalJson is key-order independent and rejects unstable values', () => {
  assert.equal(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] }), canonicalJson({ a: [2, { c: 2, d: 1 }], b: 1 }));
  assert.throws(() => canonicalJson({ a: undefined }));
  assert.throws(() => canonicalJson({ a: Number.NaN }));
});
