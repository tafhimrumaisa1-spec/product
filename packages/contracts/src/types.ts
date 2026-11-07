/**
 * FluxContracts — public types.
 *
 * Design rules (from the FluxMandate master context):
 *  - AI interprets and explains. Humans approve. Deterministic code calculates.
 *  - Money is always integer minor units (never floats).
 *  - Dates are ISO `YYYY-MM-DD` strings (no timezones, no `Date` objects in data).
 *  - Nothing in this module holds a signing key or a secret.
 */

export type ErrorCode =
  | 'AI_CANNOT_APPROVE'
  | 'NOT_HUMAN_ACTOR'
  | 'UNKNOWN_OBLIGATION'
  | 'STALE_REVISION'
  | 'BLOCKING_ISSUES'
  | 'INVALID_STATE'
  | 'UNREVIEWED_MATERIAL'
  | 'MISSING_REQUIRED'
  | 'INVALID_INPUT'
  | 'INVALID_SALT'
  | 'AI_OUTPUT_INVALID';

export interface FluxError {
  readonly code: ErrorCode;
  readonly message: string;
  readonly details?: readonly string[];
}

export type Result<T, E = FluxError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = (
  code: ErrorCode,
  message: string,
  details?: readonly string[],
): Result<never, FluxError> => ({
  ok: false,
  error: details === undefined ? { code, message } : { code, message, details },
});

// ---------------------------------------------------------------- primitives

/** Integer minor units (e.g. cents) plus an upper-case currency code. */
export interface Money {
  readonly amountMinor: number;
  readonly currency: string;
}

/** ISO calendar date, `YYYY-MM-DD`. */
export type IsoDate = string;

export type ActorKind = 'human' | 'ai' | 'system';
export interface Actor {
  readonly kind: ActorKind;
  readonly id: string;
}

/** A verbatim excerpt of the contract that supports an extracted term. */
export interface SourceSpan {
  /** Inclusive start offset into the contract text (UTF-16 code units). */
  readonly start: number;
  /** Exclusive end offset. */
  readonly end: number;
  /** Must equal `text.slice(start, end)`; checked deterministically. */
  readonly quote: string;
}

// ------------------------------------------------------------------- terms

export interface Installment {
  readonly dueDate: IsoDate;
  readonly amount: Money;
}

export type CapPeriod = 'MONTH' | 'QUARTER';

export type ObligationTerms =
  | { readonly kind: 'PARTIES'; readonly vendor: string; readonly customer: string }
  | { readonly kind: 'TOTAL_VALUE'; readonly total: Money }
  | { readonly kind: 'PERIODIC_CAP'; readonly cap: Money; readonly period: CapPeriod }
  | { readonly kind: 'PAYMENT_SCHEDULE'; readonly installments: readonly Installment[] }
  | {
      readonly kind: 'TERM';
      readonly startDate: IsoDate;
      /** Inclusive last day of the term. */
      readonly endDate: IsoDate;
      readonly durationMonths: number;
    }
  | {
      readonly kind: 'RENEWAL';
      readonly autoRenew: boolean;
      readonly renewalTermMonths: number | null;
      readonly nonRenewalNoticeDays: number | null;
    }
  | {
      readonly kind: 'TERMINATION';
      readonly forConvenience: boolean;
      readonly noticeDays: number | null;
    };

export type ObligationKind = ObligationTerms['kind'];

export const ALL_OBLIGATION_KINDS: readonly ObligationKind[] = [
  'PARTIES',
  'TOTAL_VALUE',
  'PERIODIC_CAP',
  'PAYMENT_SCHEDULE',
  'TERM',
  'RENEWAL',
  'TERMINATION',
];

/** Kinds that must be present and approved before a review can be finalized. */
export const REQUIRED_KINDS: readonly ObligationKind[] = ALL_OBLIGATION_KINDS;

/** v1: every kind is material and therefore needs explicit human approval. */
export const isMaterial = (_kind: ObligationKind): boolean => true;

// -------------------------------------------------------------- extraction

export interface ExtractorInfo {
  readonly name: string;
  readonly version: string;
  readonly kind: 'rules' | 'ai';
}

export interface ProposedObligation {
  readonly terms: ObligationTerms;
  readonly evidence: readonly SourceSpan[];
  /** 0..1, advisory only — never used to auto-approve. */
  readonly confidence: number;
}

export interface ContractDocument {
  /** Stable synthetic identifier, e.g. `FX-SYN-2026-0001`. */
  readonly contractId: string;
  /** Full text. Private: never serialized into proofs or on-chain data. */
  readonly text: string;
}

export interface ExtractionProposal {
  readonly contractId: string;
  readonly documentSha256: string;
  readonly extractor: ExtractorInfo;
  readonly obligations: readonly ProposedObligation[];
}

export interface ContractExtractor {
  readonly info: ExtractorInfo;
  extract(doc: ContractDocument): Promise<Result<ExtractionProposal>>;
}

// ------------------------------------------------------------------ review

export type ReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface Obligation {
  readonly id: string;
  readonly kind: ObligationKind;
  readonly material: boolean;
  readonly terms: ObligationTerms;
  readonly evidence: readonly SourceSpan[];
  readonly confidence: number;
  readonly proposedBy: Actor;
  readonly status: ReviewStatus;
  /** Increments on every edit; approvals bind to a specific revision. */
  readonly revision: number;
  readonly reviewedBy: Actor | null;
}

export type IssueSeverity = 'error' | 'warning';
export interface Issue {
  readonly severity: IssueSeverity;
  readonly code: string;
  readonly message: string;
  /** Obligations the issue concerns (empty for document-level issues). */
  readonly obligationIds: readonly string[];
}

export type AuditEventType =
  | 'SESSION_CREATED'
  | 'OBLIGATION_APPROVED'
  | 'OBLIGATION_REJECTED'
  | 'OBLIGATION_EDITED'
  | 'OBLIGATION_ADDED'
  | 'REVIEW_FINALIZED';

/** Hash-chained audit record. Contains digests, never contract text. */
export interface AuditEvent {
  readonly seq: number;
  readonly at: string;
  readonly actor: Actor;
  readonly type: AuditEventType;
  readonly obligationId: string | null;
  readonly revision: number | null;
  /** sha256 of canonical terms (approve/edit/add) or of the approved set (finalize). */
  readonly digest: string | null;
  readonly prevHash: string;
  readonly hash: string;
}

export interface ReviewSession {
  readonly contractId: string;
  readonly documentSha256: string;
  /** Held in memory for evidence checks. Use `toPublicSession` before storing/sending. */
  readonly documentText: string;
  readonly extractor: ExtractorInfo;
  readonly obligations: readonly Obligation[];
  readonly audit: readonly AuditEvent[];
  readonly finalized: boolean;
}

/** Session safe to persist or show to other modules: no contract text. */
export type PublicReviewSession = Omit<ReviewSession, 'documentText'>;

// ---------------------------------------------------------- approved output

export interface ApprovedObligation {
  readonly id: string;
  readonly kind: ObligationKind;
  readonly revision: number;
  readonly terms: ObligationTerms;
  readonly approvedBy: Actor;
}

export interface Commitment {
  readonly algorithm: 'sha256';
  readonly domain: string;
  /** Hex digest. The salt is returned to the caller and is never stored here. */
  readonly value: string;
}

export interface ApprovedObligationSet {
  readonly contractId: string;
  readonly documentSha256: string;
  readonly obligations: readonly ApprovedObligation[];
  readonly finalizedBy: Actor;
  readonly finalizedAt: string;
  readonly auditHeadHash: string;
  readonly commitment: Commitment;
}
