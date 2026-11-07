export type Id<T extends string> = string & { readonly __type: T };
export type ContractId = Id<"Contract">;
export type ObligationId = Id<"Obligation">;
export type MandateId = Id<"Mandate">;
export type AgentId = Id<"Agent">;

export type ContractStatus = "uploaded" | "extracting" | "needs_review" | "approved" | "committed";
export type MandateStatus = "draft" | "pending_signature" | "active" | "paused" | "expired" | "revoked";
export type SpendStatus = "proposed" | "approved" | "submitted" | "settled" | "blocked";

export interface EvidenceCitation {
  page: number;
  clause: string;
  excerpt: string;
  confidenceBps: number;
}

export interface Obligation {
  id: ObligationId;
  contractId: ContractId;
  counterparty: string;
  amountMinor: bigint;
  currency: string;
  periodSeconds: number;
  startAt: string;
  expiresAt: string;
  evidence: EvidenceCitation[];
  approvedBy?: string;
  approvedAt?: string;
}

export interface Mandate {
  id: MandateId;
  obligationId: ObligationId;
  agentId: AgentId;
  vendorAddress: string;
  assetMint: string;
  periodCapMinor: bigint;
  status: MandateStatus;
  startAt: string;
  expiresAt: string;
  delegationAddress?: string;
}

export interface SpendIntent {
  id: string;
  mandateId: MandateId;
  amountMinor: bigint;
  assetMint: string;
  recipient: string;
  requestedAt: string;
}

export interface PolicyDecision {
  intentId: string;
  status: "approved" | "blocked";
  reasonCode: "within_authority" | "cap_exceeded" | "mandate_inactive" | "wrong_asset" | "wrong_recipient" | "expired";
  explanation: string;
}

export type FluxEvent =
  | { type: "ContractUploaded"; contractId: ContractId; at: string }
  | { type: "ObligationApproved"; obligationId: ObligationId; approvedBy: string; at: string }
  | { type: "MandateActivated"; mandateId: MandateId; delegationAddress: string; at: string }
  | { type: "SpendApproved"; intentId: string; reason: string; at: string }
  | { type: "SpendBlocked"; intentId: string; reasonCode: PolicyDecision["reasonCode"]; at: string }
  | { type: "SettlementConfirmed"; intentId: string; signature: string; at: string };

export function evaluateSpend(mandate: Mandate, intent: SpendIntent, spentThisPeriodMinor: bigint, now: Date): PolicyDecision {
  if (mandate.status !== "active") return blocked(intent, "mandate_inactive", "The mandate is not active.");
  if (now < new Date(mandate.startAt) || now >= new Date(mandate.expiresAt)) return blocked(intent, "expired", "The mandate is outside its active window.");
  if (intent.assetMint !== mandate.assetMint) return blocked(intent, "wrong_asset", "The requested asset is not authorized.");
  if (intent.recipient !== mandate.vendorAddress) return blocked(intent, "wrong_recipient", "The requested recipient is not authorized.");
  if (spentThisPeriodMinor + intent.amountMinor > mandate.periodCapMinor) return blocked(intent, "cap_exceeded", "The request exceeds the remaining period allowance.");
  return { intentId: intent.id, status: "approved", reasonCode: "within_authority", explanation: "Recipient, asset, active window, and remaining allowance match." };
}

function blocked(intent: SpendIntent, reasonCode: PolicyDecision["reasonCode"], explanation: string): PolicyDecision {
  return { intentId: intent.id, status: "blocked", reasonCode, explanation };
}

