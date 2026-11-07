/** Lifecycle status vocabularies. Kept separate so schemas and state machines share one source of truth. */
export const CONTRACT_STATUSES = [
  "uploaded", "extracting", "extraction_failed", "extracted", "in_review", "active", "rejected", "expired", "terminated",
] as const;
export const OBLIGATION_STATUSES = [
  "proposed", "approved", "rejected", "active", "fulfilled", "cancelled", "expired",
] as const;
export const MANDATE_STATUSES = [
  "proposed", "approved", "active", "suspended", "rejected", "revoked", "expired", "exhausted",
] as const;
export const SPEND_INTENT_STATUSES = [
  "requested", "evaluating", "pending_human_approval", "approved", "blocked", "submitted", "settled", "failed", "cancelled", "expired",
] as const;
export const SETTLEMENT_STATUSES = ["pending", "confirmed", "finalized", "reconciled", "failed"] as const;

export type ContractStatus = (typeof CONTRACT_STATUSES)[number];
export type ObligationStatus = (typeof OBLIGATION_STATUSES)[number];
export type MandateStatus = (typeof MANDATE_STATUSES)[number];
export type SpendIntentStatus = (typeof SPEND_INTENT_STATUSES)[number];
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];
