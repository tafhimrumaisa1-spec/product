import { canonicalJson, GENESIS_HASH, sha256Hex } from './canonical.js';
import { computeCommitment, isValidSalt } from './commitment.js';
import { computeIssues, parseSpans, parseTerms } from './validate.js';
import {
  err,
  isMaterial,
  ok,
  REQUIRED_KINDS,
  type Actor,
  type ApprovedObligation,
  type ApprovedObligationSet,
  type AuditEvent,
  type AuditEventType,
  type ContractDocument,
  type ExtractionProposal,
  type Issue,
  type Obligation,
  type ObligationKind,
  type ObligationTerms,
  type PublicReviewSession,
  type Result,
  type ReviewSession,
  type SourceSpan,
} from './types.js';

/**
 * Human review workflow. All functions are pure: they return a new session and take
 * the timestamp as an argument, so runs are deterministic and replayable.
 *
 * Invariants enforced here (and covered by tests):
 *  - Only an actor of kind "human" can approve, reject, edit, add or finalize.
 *  - An approval binds to a specific obligation revision; editing resets it to PENDING.
 *  - An obligation with blocking (error) issues cannot be approved.
 *  - Finalization needs every live obligation approved, every required kind present once,
 *    and zero blocking issues. Finalized sessions are immutable.
 */

// ------------------------------------------------------------------- helpers

function requireHuman(actor: Actor): Result<Actor> {
  if (actor.kind === 'ai') return err('AI_CANNOT_APPROVE', 'AI actors cannot approve, edit or finalize obligations');
  if (actor.kind !== 'human' || actor.id.trim() === '') {
    return err('NOT_HUMAN_ACTOR', 'a human actor with a non-empty id is required');
  }
  return ok(actor);
}

function appendEvent(
  audit: readonly AuditEvent[],
  at: string,
  actor: Actor,
  type: AuditEventType,
  obligationId: string | null,
  revision: number | null,
  digest: string | null,
): AuditEvent[] {
  const prev = audit[audit.length - 1];
  const prevHash = prev ? prev.hash : GENESIS_HASH;
  const seq = audit.length;
  const hash = sha256Hex(canonicalJson({ seq, at, actor, type, obligationId, revision, digest, prevHash }));
  return [...audit, { seq, at, actor, type, obligationId, revision, digest, prevHash, hash }];
}

const termsDigest = (t: ObligationTerms): string => sha256Hex(canonicalJson(t));

const blockingFor = (issues: readonly Issue[], id: string): Issue[] =>
  issues.filter((i) => i.severity === 'error' && i.obligationIds.includes(id));

function mustFind(s: ReviewSession, id: string): Result<Obligation> {
  const o = s.obligations.find((x) => x.id === id);
  return o ? ok(o) : err('UNKNOWN_OBLIGATION', `no obligation with id "${id}"`);
}

function guard(s: ReviewSession, actor: Actor): Result<Actor> {
  if (s.finalized) return err('INVALID_STATE', 'review is finalized and can no longer change');
  return requireHuman(actor);
}

const replace = (s: ReviewSession, next: Obligation): Obligation[] =>
  s.obligations.map((o) => (o.id === next.id ? next : o));

// ------------------------------------------------------------------- session

export function createReviewSession(
  proposal: ExtractionProposal,
  doc: ContractDocument,
  at: string,
): Result<ReviewSession> {
  if (proposal.contractId !== doc.contractId) return err('INVALID_INPUT', 'proposal is for a different contract');
  if (proposal.documentSha256 !== sha256Hex(doc.text)) {
    return err('INVALID_INPUT', 'proposal was extracted from different document text');
  }
  const proposer: Actor = {
    kind: proposal.extractor.kind === 'ai' ? 'ai' : 'system',
    id: proposal.extractor.name,
  };
  const obligations: Obligation[] = proposal.obligations.map((p, i) => ({
    id: `ob-${i + 1}-${p.terms.kind.toLowerCase()}`,
    kind: p.terms.kind,
    material: isMaterial(p.terms.kind),
    terms: p.terms,
    evidence: p.evidence,
    confidence: p.confidence,
    proposedBy: proposer,
    status: 'PENDING',
    revision: 1,
    reviewedBy: null,
  }));
  const audit = appendEvent([], at, { kind: 'system', id: 'fluxcontracts' }, 'SESSION_CREATED', null, null, proposal.documentSha256);
  return ok({
    contractId: doc.contractId,
    documentSha256: proposal.documentSha256,
    documentText: doc.text,
    extractor: proposal.extractor,
    obligations,
    audit,
    finalized: false,
  });
}

export const sessionIssues = (s: ReviewSession): Issue[] => computeIssues(s.obligations, s.documentText);

/** Strip the contract text so the session can be stored or passed to other modules. */
export function toPublicSession(s: ReviewSession): PublicReviewSession {
  const { documentText: _omit, ...rest } = s;
  void _omit;
  return rest;
}

// ------------------------------------------------------------------- actions

export function approveObligation(
  s: ReviewSession,
  id: string,
  expectedRevision: number,
  actor: Actor,
  at: string,
): Result<ReviewSession> {
  const g = guard(s, actor);
  if (!g.ok) return g;
  const f = mustFind(s, id);
  if (!f.ok) return f;
  const o = f.value;
  if (o.revision !== expectedRevision) {
    return err('STALE_REVISION', `obligation is at revision ${o.revision}, review saw ${expectedRevision}`);
  }
  if (o.status !== 'PENDING') return err('INVALID_STATE', `obligation is ${o.status}, only PENDING can be approved`);
  const blocking = blockingFor(sessionIssues(s), id);
  if (blocking.length > 0) {
    return err('BLOCKING_ISSUES', 'resolve blocking issues before approving', blocking.map((i) => `${i.code}: ${i.message}`));
  }
  const next: Obligation = { ...o, status: 'APPROVED', reviewedBy: actor };
  return ok({
    ...s,
    obligations: replace(s, next),
    audit: appendEvent(s.audit, at, actor, 'OBLIGATION_APPROVED', id, o.revision, termsDigest(o.terms)),
  });
}

export function rejectObligation(s: ReviewSession, id: string, actor: Actor, at: string): Result<ReviewSession> {
  const g = guard(s, actor);
  if (!g.ok) return g;
  const f = mustFind(s, id);
  if (!f.ok) return f;
  const o = f.value;
  if (o.status === 'REJECTED') return err('INVALID_STATE', 'obligation is already rejected');
  const next: Obligation = { ...o, status: 'REJECTED', reviewedBy: actor };
  return ok({
    ...s,
    obligations: replace(s, next),
    audit: appendEvent(s.audit, at, actor, 'OBLIGATION_REJECTED', id, o.revision, termsDigest(o.terms)),
  });
}

export interface EditInput {
  /** Replacement terms (runtime-validated). Must keep the same kind. */
  readonly terms?: unknown;
  /** Replacement evidence spans (runtime-validated, re-checked against the document). */
  readonly evidence?: unknown;
}

export function editObligation(
  s: ReviewSession,
  id: string,
  edit: EditInput,
  actor: Actor,
  at: string,
): Result<ReviewSession> {
  const g = guard(s, actor);
  if (!g.ok) return g;
  const f = mustFind(s, id);
  if (!f.ok) return f;
  const o = f.value;
  let terms: ObligationTerms = o.terms;
  let evidence: readonly SourceSpan[] = o.evidence;
  if (edit.terms === undefined && edit.evidence === undefined) return err('INVALID_INPUT', 'nothing to edit');
  if (edit.terms !== undefined) {
    const p = parseTerms(edit.terms);
    if (!p.ok) return p;
    if (p.value.kind !== o.kind) return err('INVALID_INPUT', `cannot change kind from ${o.kind} to ${p.value.kind}`);
    terms = p.value;
  }
  if (edit.evidence !== undefined) {
    const p = parseSpans(edit.evidence);
    if (!p.ok) return p;
    evidence = p.value;
  }
  const next: Obligation = {
    ...o,
    terms,
    evidence,
    status: 'PENDING',
    revision: o.revision + 1,
    reviewedBy: null,
    proposedBy: actor,
  };
  return ok({
    ...s,
    obligations: replace(s, next),
    audit: appendEvent(s.audit, at, actor, 'OBLIGATION_EDITED', id, next.revision, termsDigest(terms)),
  });
}

/** A human adds a term the extractor missed. Needs evidence; still requires approval. */
export function addObligation(
  s: ReviewSession,
  input: { readonly terms: unknown; readonly evidence: unknown },
  actor: Actor,
  at: string,
): Result<ReviewSession> {
  const g = guard(s, actor);
  if (!g.ok) return g;
  const t = parseTerms(input.terms);
  if (!t.ok) return t;
  const e = parseSpans(input.evidence);
  if (!e.ok) return e;
  const o: Obligation = {
    id: `ob-${s.obligations.length + 1}-${t.value.kind.toLowerCase()}`,
    kind: t.value.kind,
    material: isMaterial(t.value.kind),
    terms: t.value,
    evidence: e.value,
    confidence: 1,
    proposedBy: actor,
    status: 'PENDING',
    revision: 1,
    reviewedBy: null,
  };
  return ok({
    ...s,
    obligations: [...s.obligations, o],
    audit: appendEvent(s.audit, at, actor, 'OBLIGATION_ADDED', o.id, 1, termsDigest(o.terms)),
  });
}

export interface FinalizedReview {
  readonly session: ReviewSession;
  readonly approved: ApprovedObligationSet;
}

export function finalizeReview(
  s: ReviewSession,
  actor: Actor,
  at: string,
  saltHex: string,
): Result<FinalizedReview> {
  const g = guard(s, actor);
  if (!g.ok) return g;
  if (!isValidSalt(saltHex)) return err('INVALID_SALT', 'salt must be 32 bytes as 64 hex characters');

  const live = s.obligations.filter((o) => o.status !== 'REJECTED');
  const pending = live.filter((o) => o.material && o.status !== 'APPROVED');
  if (pending.length > 0) {
    return err('UNREVIEWED_MATERIAL', 'every material obligation must be approved by a human', pending.map((o) => o.id));
  }
  const missing: ObligationKind[] = REQUIRED_KINDS.filter((k) => live.filter((o) => o.kind === k).length !== 1);
  if (missing.length > 0) {
    return err('MISSING_REQUIRED', 'each required obligation kind must be present exactly once', missing);
  }
  const blocking = sessionIssues(s).filter((i) => i.severity === 'error');
  if (blocking.length > 0) {
    return err('BLOCKING_ISSUES', 'resolve blocking issues before finalizing', blocking.map((i) => `${i.code}: ${i.message}`));
  }

  const approvedObligations: ApprovedObligation[] = live.map((o) => ({
    id: o.id,
    kind: o.kind,
    revision: o.revision,
    terms: o.terms,
    approvedBy: o.reviewedBy as Actor,
  }));
  const c = computeCommitment(s.contractId, s.documentSha256, approvedObligations, saltHex);
  if (!c.ok) return c;

  const audit = appendEvent(s.audit, at, actor, 'REVIEW_FINALIZED', null, null, c.value.value);
  const head = audit[audit.length - 1] as AuditEvent;
  return ok({
    session: { ...s, audit, finalized: true },
    approved: {
      contractId: s.contractId,
      documentSha256: s.documentSha256,
      obligations: approvedObligations,
      finalizedBy: actor,
      finalizedAt: at,
      auditHeadHash: head.hash,
      commitment: c.value,
    },
  });
}

/** Recompute every hash in the chain; true only if the log is intact and in order. */
export function verifyAuditChain(events: readonly AuditEvent[]): boolean {
  let prev = GENESIS_HASH;
  for (const [i, e] of events.entries()) {
    if (e.seq !== i || e.prevHash !== prev) return false;
    const h = sha256Hex(
      canonicalJson({
        seq: e.seq, at: e.at, actor: e.actor, type: e.type,
        obligationId: e.obligationId, revision: e.revision, digest: e.digest, prevHash: e.prevHash,
      }),
    );
    if (h !== e.hash) return false;
    prev = e.hash;
  }
  return true;
}
