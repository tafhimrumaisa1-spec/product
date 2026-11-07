import assert from 'node:assert/strict';
import { extractWithRules } from '../src/extract/rules.js';
import { SYNTHETIC_COMPUTE_CONTRACT } from '../src/fixtures/syntheticComputeContract.js';
import { createReviewSession, approveObligation } from '../src/review.js';
import type { Actor, ReviewSession, Result } from '../src/types.js';

export const AT = '2026-01-01T00:00:00.000Z';
export const HUMAN: Actor = { kind: 'human', id: 'reviewer-alice' };
export const AI: Actor = { kind: 'ai', id: 'model-x' };

export function unwrap<T>(r: Result<T>): T {
  assert.equal(r.ok, true, r.ok ? '' : `${r.error.code}: ${r.error.message}`);
  return (r as { ok: true; value: T }).value;
}

export function freshSession(): ReviewSession {
  const proposal = extractWithRules(SYNTHETIC_COMPUTE_CONTRACT);
  return unwrap(createReviewSession(proposal, SYNTHETIC_COMPUTE_CONTRACT, AT));
}

export function approveAll(s: ReviewSession): ReviewSession {
  let cur = s;
  for (const o of s.obligations) cur = unwrap(approveObligation(cur, o.id, o.revision, HUMAN, AT));
  return cur;
}
