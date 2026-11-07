/**
 * Machine-readable reason codes + deterministic human-readable explanations.
 * Events store only `code` + raw `params`; text is derived, so it can be re-rendered or localised
 * later without rewriting history.
 */
import { DEFAULT_CURRENCY, formatAmount } from './money.js';

export const ReasonCodes = {
  // Policy outcomes (spend intents)
  APPROVED_WITHIN_MANDATE: 'APPROVED_WITHIN_MANDATE',
  MANDATE_NOT_FOUND: 'MANDATE_NOT_FOUND',
  MANDATE_REVOKED: 'MANDATE_REVOKED',
  MANDATE_EXPIRED: 'MANDATE_EXPIRED',
  MANDATE_NOT_STARTED: 'MANDATE_NOT_STARTED',
  DELEGATION_NOT_FOUND: 'DELEGATION_NOT_FOUND',
  AGENT_NOT_DELEGATED: 'AGENT_NOT_DELEGATED',
  VENDOR_MISMATCH: 'VENDOR_MISMATCH',
  CURRENCY_MISMATCH: 'CURRENCY_MISMATCH',
  AMOUNT_NOT_POSITIVE: 'AMOUNT_NOT_POSITIVE',
  PER_PAYMENT_LIMIT_EXCEEDED: 'PER_PAYMENT_LIMIT_EXCEEDED',
  PERIOD_CAP_EXCEEDED: 'PERIOD_CAP_EXCEEDED',
  MANDATE_ALLOWANCE_EXCEEDED: 'MANDATE_ALLOWANCE_EXCEEDED',
  // Ledger integrity findings (event ignored by projections, recorded as anomaly)
  DUPLICATE_ENTITY: 'DUPLICATE_ENTITY',
  DUPLICATE_SETTLEMENT_ID: 'DUPLICATE_SETTLEMENT_ID',
  DUPLICATE_SETTLEMENT_SIGNATURE: 'DUPLICATE_SETTLEMENT_SIGNATURE',
  DUPLICATE_SETTLEMENT_INTENT: 'DUPLICATE_SETTLEMENT_INTENT',
  SETTLEMENT_WITHOUT_APPROVED_DECISION: 'SETTLEMENT_WITHOUT_APPROVED_DECISION',
  SETTLEMENT_AMOUNT_MISMATCH: 'SETTLEMENT_AMOUNT_MISMATCH',
  SETTLEMENT_VENDOR_MISMATCH: 'SETTLEMENT_VENDOR_MISMATCH',
  SETTLEMENT_SIGNATURE_MISMATCH: 'SETTLEMENT_SIGNATURE_MISMATCH',
  TRANSACTION_FOR_UNAPPROVED_INTENT: 'TRANSACTION_FOR_UNAPPROVED_INTENT',
  DECISION_CONFLICT: 'DECISION_CONFLICT',
  UNKNOWN_REFERENCE: 'UNKNOWN_REFERENCE',
  UNSUPPORTED_CURRENCY: 'UNSUPPORTED_CURRENCY',
  INVALID_PAYLOAD: 'INVALID_PAYLOAD',
  NON_HUMAN_APPROVER: 'NON_HUMAN_APPROVER',
  MANDATE_EXCEEDS_OBLIGATION: 'MANDATE_EXCEEDS_OBLIGATION',
  MANDATE_OBLIGATION_VENDOR_MISMATCH: 'MANDATE_OBLIGATION_VENDOR_MISMATCH',
} as const;

export type ReasonCode = (typeof ReasonCodes)[keyof typeof ReasonCodes];
export type ReasonParams = Readonly<Record<string, string>>;
export type ReasonCategory = 'approval' | 'rejection' | 'integrity';

export interface ReasonDefinition {
  readonly category: ReasonCategory;
  readonly title: string;
  readonly describe: (params: ReasonParams) => string;
}

const q = (p: ReasonParams, key: string): string => p[key] ?? '(unknown)';

function money(p: ReasonParams, key: string): string {
  const raw = p[key];
  if (raw === undefined || !/^-?\d+$/.test(raw)) return '(unknown amount)';
  return formatAmount(BigInt(raw), p['currency'] ?? DEFAULT_CURRENCY);
}

const def = (category: ReasonCategory, title: string, describe: (p: ReasonParams) => string): ReasonDefinition => ({ category, title, describe });

export const REASON_DEFINITIONS: Readonly<Record<ReasonCode, ReasonDefinition>> = {
  APPROVED_WITHIN_MANDATE: def('approval', 'Approved within mandate', (p) =>
    `Payment of ${money(p, 'amountMinor')} is within the mandate: vendor, delegated agent, validity window and all limits check out (${money(p, 'remainingAfterMinor')} of total allowance remains afterwards).`),
  MANDATE_NOT_FOUND: def('rejection', 'Mandate not found', (p) => `No mandate named ${q(p, 'mandateId')} exists, so the agent has no spending authority.`),
  MANDATE_REVOKED: def('rejection', 'Mandate revoked', (p) => `Mandate ${q(p, 'mandateId')} was revoked by a human, so no further spending is allowed.`),
  MANDATE_EXPIRED: def('rejection', 'Mandate expired', (p) => `Mandate ${q(p, 'mandateId')} expired at ${q(p, 'expiresAt')}.`),
  MANDATE_NOT_STARTED: def('rejection', 'Mandate not yet active', (p) => `Mandate ${q(p, 'mandateId')} only becomes valid at ${q(p, 'startsAt')}.`),
  DELEGATION_NOT_FOUND: def('rejection', 'Delegation not found', (p) => `Delegation ${q(p, 'delegationId')} does not exist for mandate ${q(p, 'mandateId')}.`),
  AGENT_NOT_DELEGATED: def('rejection', 'Agent not delegated', (p) => `Agent ${q(p, 'agentId')} is not the agent delegated under ${q(p, 'delegationId')}.`),
  VENDOR_MISMATCH: def('rejection', 'Vendor does not match contract', (p) =>
    `The payment targets vendor ${q(p, 'intentVendorId')} but the mandate only permits payments to ${q(p, 'mandateVendorId')}.`),
  CURRENCY_MISMATCH: def('rejection', 'Currency does not match', (p) => `The payment currency ${q(p, 'intentCurrency')} differs from the mandate currency ${q(p, 'mandateCurrency')}.`),
  AMOUNT_NOT_POSITIVE: def('rejection', 'Amount must be positive', () => 'The payment amount must be greater than zero.'),
  PER_PAYMENT_LIMIT_EXCEEDED: def('rejection', 'Per-payment limit exceeded', (p) =>
    `The payment of ${money(p, 'amountMinor')} exceeds the per-payment limit of ${money(p, 'perPaymentLimitMinor')}.`),
  PERIOD_CAP_EXCEEDED: def('rejection', 'Periodic cap exceeded', (p) =>
    `Paying ${money(p, 'amountMinor')} would bring spending in the current ${q(p, 'periodDays')}-day period to ${money(p, 'periodProjectedMinor')}, above the cap of ${money(p, 'periodCapMinor')}.`),
  MANDATE_ALLOWANCE_EXCEEDED: def('rejection', 'Total allowance exceeded', (p) =>
    `The payment of ${money(p, 'amountMinor')} exceeds the remaining mandate allowance of ${money(p, 'remainingMinor')} (total limit ${money(p, 'limitMinor')}).`),

  DUPLICATE_ENTITY: def('integrity', 'Duplicate identifier', (p) => `A ${q(p, 'entity')} with id ${q(p, 'id')} already exists; the later event was ignored.`),
  DUPLICATE_SETTLEMENT_ID: def('integrity', 'Duplicate settlement id', (p) => `Settlement ${q(p, 'settlementId')} was already booked; the repeat was not counted again.`),
  DUPLICATE_SETTLEMENT_SIGNATURE: def('integrity', 'Duplicate transaction signature', (p) =>
    `Transaction ${q(p, 'signature')} on ${q(p, 'cluster')} was already booked as settlement ${q(p, 'originalSettlementId')}; the repeat was not counted again.`),
  DUPLICATE_SETTLEMENT_INTENT: def('integrity', 'Intent already settled', (p) =>
    `Spend intent ${q(p, 'intentId')} was already settled as ${q(p, 'originalSettlementId')}; a second settlement was not counted.`),
  SETTLEMENT_WITHOUT_APPROVED_DECISION: def('integrity', 'Settlement without approval', (p) =>
    `Settlement ${q(p, 'settlementId')} refers to intent ${q(p, 'intentId')} which has no approving policy decision (status: ${q(p, 'intentStatus')}).`),
  SETTLEMENT_AMOUNT_MISMATCH: def('integrity', 'Settled amount differs from intent', (p) =>
    `Settlement ${q(p, 'settlementId')} moved ${money(p, 'settledMinor')} but the approved intent was for ${money(p, 'intentMinor')}.`),
  SETTLEMENT_VENDOR_MISMATCH: def('integrity', 'Settled vendor differs from intent', (p) =>
    `Settlement ${q(p, 'settlementId')} paid vendor ${q(p, 'settledVendorId')} but the approved intent named ${q(p, 'intentVendorId')}.`),
  SETTLEMENT_SIGNATURE_MISMATCH: def('integrity', 'Settlement signature differs from submitted transaction', (p) =>
    `Settlement ${q(p, 'settlementId')} cites a different signature than the transaction submitted for intent ${q(p, 'intentId')}.`),
  TRANSACTION_FOR_UNAPPROVED_INTENT: def('integrity', 'Transaction for unapproved intent', (p) =>
    `A transaction was recorded for intent ${q(p, 'intentId')}, which is not in an approved state (status: ${q(p, 'intentStatus')}).`),
  DECISION_CONFLICT: def('integrity', 'Conflicting policy decision', (p) => `Intent ${q(p, 'intentId')} already has a policy decision; the later decision was ignored.`),
  UNKNOWN_REFERENCE: def('integrity', 'Reference to unknown record', (p) => `The event refers to ${q(p, 'entity')} ${q(p, 'id')}, which has not been recorded.`),
  UNSUPPORTED_CURRENCY: def('integrity', 'Unsupported currency', (p) => `Currency ${q(p, 'currency')} is not supported by this ledger (expected ${q(p, 'expected')}).`),
  INVALID_PAYLOAD: def('integrity', 'Invalid event payload', (p) => `The event payload is invalid: ${q(p, 'detail')}.`),
  NON_HUMAN_APPROVER: def('integrity', 'Approval not made by a human', (p) =>
    `Approver ${q(p, 'approvedBy')} is not a human actor ("human:" prefix required); AI agents cannot approve obligations or mandates.`),
  MANDATE_EXCEEDS_OBLIGATION: def('integrity', 'Mandate larger than obligation', (p) =>
    `The mandate limit ${money(p, 'limitMinor')} exceeds the approved obligation total ${money(p, 'obligationMinor')}.`),
  MANDATE_OBLIGATION_VENDOR_MISMATCH: def('integrity', 'Mandate vendor differs from obligation', (p) =>
    `Mandate vendor ${q(p, 'mandateVendorId')} differs from the approved obligation vendor ${q(p, 'obligationVendorId')}.`),
};

export function isReasonCode(value: unknown): value is ReasonCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(REASON_DEFINITIONS, value);
}

export function describeReason(code: ReasonCode, params: ReasonParams = {}): string {
  return REASON_DEFINITIONS[code].describe(params);
}

export function reasonTitle(code: ReasonCode): string {
  return REASON_DEFINITIONS[code].title;
}

export interface DecisionExplanation {
  readonly headline: string;
  readonly reasons: readonly string[];
}

/** Turns stored decision codes + params into text a finance reviewer can read. */
export function explainDecision(decision: 'approved' | 'rejected', codes: readonly ReasonCode[], params: ReasonParams = {}): DecisionExplanation {
  const reasons = codes.map((c) => describeReason(c, params));
  const first = codes[0];
  const headline = decision === 'approved' ? 'Approved' : `Rejected: ${first ? reasonTitle(first) : 'no reason recorded'}`;
  return { headline, reasons };
}
