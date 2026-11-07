import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addObligation,
  approveObligation,
  editObligation,
  finalizeReview,
  rejectObligation,
  sessionIssues,
  toPublicSession,
  verifyAuditChain,
} from '../src/review.js';
import { FIXTURE_SALT_HEX, SYNTHETIC_COMPUTE_CONTRACT } from '../src/fixtures/syntheticComputeContract.js';
import { AI, AT, HUMAN, approveAll, freshSession, unwrap } from './helpers.js';

const code = (r: { ok: boolean; error?: { code: string } }) => (r.ok ? 'ok' : r.error?.code);

test('AI actor can never approve, reject, edit, add or finalize', () => {
  const s = freshSession();
  const o = s.obligations[0]!;
  assert.equal(code(approveObligation(s, o.id, o.revision, AI, AT)), 'AI_CANNOT_APPROVE');
  assert.equal(code(rejectObligation(s, o.id, AI, AT)), 'AI_CANNOT_APPROVE');
  assert.equal(code(editObligation(s, o.id, { terms: o.terms }, AI, AT)), 'AI_CANNOT_APPROVE');
  assert.equal(code(addObligation(s, { terms: o.terms, evidence: o.evidence }, AI, AT)), 'AI_CANNOT_APPROVE');
  assert.equal(code(finalizeReview(approveAll(s), AI, AT, FIXTURE_SALT_HEX)), 'AI_CANNOT_APPROVE');
});

test('system actors and anonymous humans cannot approve', () => {
  const s = freshSession();
  const o = s.obligations[0]!;
  assert.equal(code(approveObligation(s, o.id, o.revision, { kind: 'system', id: 'x' }, AT)), 'NOT_HUMAN_ACTOR');
  assert.equal(code(approveObligation(s, o.id, o.revision, { kind: 'human', id: ' ' }, AT)), 'NOT_HUMAN_ACTOR');
});

test('cannot finalize until every material obligation is approved', () => {
  let s = freshSession();
  assert.equal(code(finalizeReview(s, HUMAN, AT, FIXTURE_SALT_HEX)), 'UNREVIEWED_MATERIAL');
  for (const o of s.obligations.slice(0, -1)) s = unwrap(approveObligation(s, o.id, o.revision, HUMAN, AT));
  const r = finalizeReview(s, HUMAN, AT, FIXTURE_SALT_HEX);
  assert.equal(code(r), 'UNREVIEWED_MATERIAL');
  assert.deepEqual(!r.ok && r.error.details, [s.obligations.at(-1)!.id]);
});

test('happy path: approve all, finalize, immutable afterwards', () => {
  const s = approveAll(freshSession());
  const { session, approved } = unwrap(finalizeReview(s, HUMAN, AT, FIXTURE_SALT_HEX));
  assert.equal(session.finalized, true);
  assert.equal(approved.obligations.length, 7);
  assert.equal(approved.auditHeadHash, session.audit.at(-1)!.hash);
  assert.equal(code(approveObligation(session, 'ob-1-parties', 1, HUMAN, AT)), 'INVALID_STATE');
  assert.equal(code(finalizeReview(session, HUMAN, AT, FIXTURE_SALT_HEX)), 'INVALID_STATE');
});

test('approval is bound to a revision; editing invalidates it', () => {
  let s = freshSession();
  const cap = s.obligations.find((o) => o.kind === 'PERIODIC_CAP')!;
  assert.equal(code(approveObligation(s, cap.id, 99, HUMAN, AT)), 'STALE_REVISION');
  s = unwrap(approveObligation(s, cap.id, cap.revision, HUMAN, AT));
  s = unwrap(editObligation(s, cap.id, { terms: { ...cap.terms, cap: { amountMinor: 1_500_000, currency: 'USD' } } }, HUMAN, AT));
  const edited = s.obligations.find((o) => o.id === cap.id)!;
  assert.equal(edited.status, 'PENDING');
  assert.equal(edited.revision, 2);
  assert.equal(edited.reviewedBy, null);
  assert.equal(code(approveObligation(s, cap.id, 1, HUMAN, AT)), 'STALE_REVISION');
});

test('an edit that breaks cross-checks blocks approval and finalization', () => {
  let s = freshSession();
  const total = s.obligations.find((o) => o.kind === 'TOTAL_VALUE')!;
  s = unwrap(editObligation(s, total.id, { terms: { kind: 'TOTAL_VALUE', total: { amountMinor: 7_000_000, currency: 'USD' } } }, HUMAN, AT));
  assert.ok(sessionIssues(s).some((i) => i.code === 'SCHEDULE_TOTAL_MISMATCH'));
  const e = approveObligation(s, total.id, 2, HUMAN, AT);
  assert.equal(code(e), 'BLOCKING_ISSUES');
  assert.equal(code(finalizeReview(s, HUMAN, AT, FIXTURE_SALT_HEX)), 'UNREVIEWED_MATERIAL');
});

test('periodic cap lower than a month of installments is flagged', () => {
  let s = freshSession();
  const cap = s.obligations.find((o) => o.kind === 'PERIODIC_CAP')!;
  s = unwrap(editObligation(s, cap.id, { terms: { kind: 'PERIODIC_CAP', cap: { amountMinor: 500_000, currency: 'USD' }, period: 'MONTH' } }, HUMAN, AT));
  assert.ok(sessionIssues(s).some((i) => i.code === 'CAP_EXCEEDED'));
});

test('hallucinated evidence is blocked from approval until fixed', () => {
  let s = freshSession();
  const parties = s.obligations.find((o) => o.kind === 'PARTIES')!;
  s = unwrap(editObligation(s, parties.id, { evidence: [{ start: 0, end: 5, quote: 'bogus' }] }, HUMAN, AT));
  assert.ok(sessionIssues(s).some((i) => i.code === 'EVIDENCE_MISMATCH'));
  assert.equal(code(approveObligation(s, parties.id, 2, HUMAN, AT)), 'BLOCKING_ISSUES');
  const fixed = SYNTHETIC_COMPUTE_CONTRACT.text.slice(0, 9);
  s = unwrap(editObligation(s, parties.id, { evidence: [{ start: 0, end: 9, quote: fixed }] }, HUMAN, AT));
  unwrap(approveObligation(s, parties.id, 3, HUMAN, AT));
});

test('rejecting a wrong term and adding the right one lets the review finish', () => {
  let s = freshSession();
  const term = s.obligations.find((o) => o.kind === 'TERM')!;
  s = unwrap(rejectObligation(s, term.id, HUMAN, AT));
  // Rejected → required kind missing.
  s = approveAllLive(s);
  assert.equal(code(finalizeReview(s, HUMAN, AT, FIXTURE_SALT_HEX)), 'MISSING_REQUIRED');
  s = unwrap(addObligation(s, { terms: term.terms, evidence: term.evidence }, HUMAN, AT));
  s = approveAllLive(s);
  const { approved } = unwrap(finalizeReview(s, HUMAN, AT, FIXTURE_SALT_HEX));
  assert.equal(approved.obligations.filter((o) => o.kind === 'TERM').length, 1);
});

function approveAllLive(s: ReturnType<typeof freshSession>) {
  let cur = s;
  for (const o of s.obligations) if (o.status === 'PENDING') cur = unwrap(approveObligation(cur, o.id, o.revision, HUMAN, AT));
  return cur;
}

test('duplicate kinds are a blocking issue', () => {
  let s = freshSession();
  const t = s.obligations.find((o) => o.kind === 'TERMINATION')!;
  s = unwrap(addObligation(s, { terms: t.terms, evidence: t.evidence }, HUMAN, AT));
  assert.ok(sessionIssues(s).some((i) => i.code === 'DUPLICATE_KIND'));
});

test('edit cannot change kind and rejects malformed input', () => {
  const s = freshSession();
  const o = s.obligations[0]!;
  assert.equal(code(editObligation(s, o.id, { terms: { kind: 'TOTAL_VALUE', total: { amountMinor: 1, currency: 'USD' } } }, HUMAN, AT)), 'INVALID_INPUT');
  assert.equal(code(editObligation(s, o.id, { terms: { kind: 'PARTIES' } }, HUMAN, AT)), 'INVALID_INPUT');
  assert.equal(code(editObligation(s, o.id, {}, HUMAN, AT)), 'INVALID_INPUT');
  assert.equal(code(approveObligation(s, 'nope', 1, HUMAN, AT)), 'UNKNOWN_OBLIGATION');
});

test('audit log is hash-chained and tamper-evident', () => {
  const s = approveAll(freshSession());
  assert.equal(verifyAuditChain(s.audit), true);
  const tampered = s.audit.map((e, i) => (i === 2 ? { ...e, actor: { kind: 'human' as const, id: 'mallory' } } : e));
  assert.equal(verifyAuditChain(tampered), false);
  assert.equal(verifyAuditChain(s.audit.slice(1)), false);
});

test('public session and audit log never contain contract text', () => {
  const s = approveAll(freshSession());
  assert.equal('documentText' in toPublicSession(s), false);
  // Evidence quotes are private excerpts by design; the audit chain must carry digests only.
  const auditOnly = JSON.stringify(s.audit);
  assert.equal(auditOnly.includes('Meridian'), false);
  assert.equal(auditOnly.includes('Halcyon'), false);
  assert.equal(JSON.stringify(toPublicSession(s)).includes('GPU compute capacity'), false);
});

test('mismatched proposal and document are rejected', async () => {
  const { createReviewSession } = await import('../src/review.js');
  const { extractWithRules } = await import('../src/extract/rules.js');
  const p = extractWithRules(SYNTHETIC_COMPUTE_CONTRACT);
  const r = createReviewSession(p, { ...SYNTHETIC_COMPUTE_CONTRACT, text: SYNTHETIC_COMPUTE_CONTRACT.text + ' ' }, AT);
  assert.equal(code(r), 'INVALID_INPUT');
});
