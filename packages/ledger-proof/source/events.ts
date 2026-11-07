/**
 * Audit event model. Events are immutable facts; every projection and every proof trace is
 * derived from them. Money fields are decimal strings of minor units (see money.ts).
 *
 * Privacy: contract documents never appear here. Only salted commitments, ids and (private)
 * short excerpt previews that redaction helpers strip for public views.
 *
 * Actor convention: human actors are "human:<id>"; agents are "agent:<id>"; services "service:<id>".
 */
import type { ReasonCode } from './reasons.js';

export type SolanaCluster = 'localnet' | 'devnet';
export const EVENT_SCHEMA_VERSION = 1 as const;

export interface EventEnvelope<T extends string, P> {
  readonly eventId: string;
  readonly type: T;
  /** ISO-8601 time the fact occurred, supplied by the producer (the store never reads a clock). */
  readonly occurredAt: string;
  readonly schemaVersion: typeof EVENT_SCHEMA_VERSION;
  /** Producing module, e.g. "FluxContracts". Informational. */
  readonly source?: string;
  readonly payload: P;
}

export interface ContractRegisteredPayload {
  contractId: string; vendorId: string; vendorName: string; title: string;
  /** Salted SHA-256 commitment of the private document. */
  documentCommitment: string; synthetic: boolean;
}
export interface ContractVersionRecordedPayload {
  contractVersionId: string; contractId: string; versionNumber: number; documentCommitment: string; signedAt: string;
}
export interface EvidenceClauseLinkedPayload {
  clauseId: string; contractVersionId: string; label: string; locator: string; excerptCommitment: string;
  /** Private; removed by public redaction. */
  excerptPreview?: string;
}
export interface ObligationApprovedPayload {
  obligationId: string; contractId: string; contractVersionId: string; clauseIds: string[]; vendorId: string;
  description: string; currency: string; totalMinor: string; periodCapMinor?: string; periodDays?: number;
  approvedBy: string; approvedAt: string;
}
export interface TwinScenarioRecordedPayload {
  scenarioId: string; obligationIds: string[]; label: string;
  cashDeltaMinor: string; monthlyBurnDeltaMinor: string; runwayMonthsBefore: number; runwayMonthsAfter: number;
}
export interface MandateCreatedPayload {
  mandateId: string; obligationId: string; contractId: string; vendorId: string; currency: string;
  limitMinor: string; perPaymentLimitMinor?: string; periodCapMinor?: string; periodDays?: number;
  startsAt: string; expiresAt: string; twinScenarioId?: string; approvedBy: string; onchainAccount?: string;
}
export interface MandateRevokedPayload { mandateId: string; revokedBy: string; reasonText: string }
export interface DelegationGrantedPayload { delegationId: string; mandateId: string; agentId: string; grantedBy: string }
export interface SpendIntentSubmittedPayload {
  intentId: string; mandateId: string; delegationId: string; agentId: string; taskId: string; vendorId: string;
  currency: string; amountMinor: string; memo?: string;
}
export interface PolicyDecisionRecordedPayload {
  decisionId: string; intentId: string; decision: 'approved' | 'rejected';
  reasonCodes: ReasonCode[]; reasonParams?: Record<string, string>; evaluatedAt: string;
}
export interface TransactionSubmittedPayload { intentId: string; signature: string; cluster: SolanaCluster; submittedAt: string }
export interface SettlementConfirmedPayload {
  settlementId: string; intentId: string; signature: string; cluster: SolanaCluster; vendorId: string;
  currency: string; amountMinor: string; slot: number; confirmedAt: string;
}
export interface SettlementFailedPayload { intentId: string; signature?: string; reasonText: string; failedAt: string }
export interface TaskRevenueRecordedPayload {
  revenueId: string; taskId: string; currency: string; amountMinor: string; customerRef?: string; recordedAt: string;
}

export type ContractRegistered = EventEnvelope<'ContractRegistered', ContractRegisteredPayload>;
export type ContractVersionRecorded = EventEnvelope<'ContractVersionRecorded', ContractVersionRecordedPayload>;
export type EvidenceClauseLinked = EventEnvelope<'EvidenceClauseLinked', EvidenceClauseLinkedPayload>;
export type ObligationApproved = EventEnvelope<'ObligationApproved', ObligationApprovedPayload>;
export type TwinScenarioRecorded = EventEnvelope<'TwinScenarioRecorded', TwinScenarioRecordedPayload>;
export type MandateCreated = EventEnvelope<'MandateCreated', MandateCreatedPayload>;
export type MandateRevoked = EventEnvelope<'MandateRevoked', MandateRevokedPayload>;
export type DelegationGranted = EventEnvelope<'DelegationGranted', DelegationGrantedPayload>;
export type SpendIntentSubmitted = EventEnvelope<'SpendIntentSubmitted', SpendIntentSubmittedPayload>;
export type PolicyDecisionRecorded = EventEnvelope<'PolicyDecisionRecorded', PolicyDecisionRecordedPayload>;
export type TransactionSubmitted = EventEnvelope<'TransactionSubmitted', TransactionSubmittedPayload>;
export type SettlementConfirmed = EventEnvelope<'SettlementConfirmed', SettlementConfirmedPayload>;
export type SettlementFailed = EventEnvelope<'SettlementFailed', SettlementFailedPayload>;
export type TaskRevenueRecorded = EventEnvelope<'TaskRevenueRecorded', TaskRevenueRecordedPayload>;

/** What producers hand to the store. */
export type AuditEventInput =
  | ContractRegistered | ContractVersionRecorded | EvidenceClauseLinked | ObligationApproved
  | TwinScenarioRecorded | MandateCreated | MandateRevoked | DelegationGranted | SpendIntentSubmitted
  | PolicyDecisionRecorded | TransactionSubmitted | SettlementConfirmed | SettlementFailed | TaskRevenueRecorded;

export type AuditEventType = AuditEventInput['type'];

export interface StoredFields {
  /** Assigned by the store: 1-based, gap-free, strictly increasing. */
  readonly sequence: number;
  /** Hash of the previous event ("0"×64 for the first). */
  readonly prevHash: string;
  /** SHA-256 over the canonical form of this event including prevHash. */
  readonly hash: string;
}

export type AuditEvent = AuditEventInput & StoredFields;

export type EventOfType<T extends AuditEventType> = Extract<AuditEvent, { type: T }>;

export const GENESIS_HASH = '0'.repeat(64);

export function isHumanActor(actor: string): boolean {
  return /^human:[A-Za-z0-9._@-]{1,120}$/.test(actor);
}
