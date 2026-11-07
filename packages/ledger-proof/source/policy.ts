/**
 * Reference policy evaluator (pure).
 *
 * IMPORTANT: this is NOT the enforcement point. Solana programs enforce spending authority.
 * This function mirrors the documented rules so that (a) FluxLedger can preview and explain a
 * decision, (b) fixtures are consistent and (c) FluxFlow/FluxMandate can reuse the same reason
 * codes. Whatever the on-chain program decides is the truth recorded in PolicyDecisionRecorded.
 */
import { type ReasonCode, ReasonCodes, type ReasonParams, describeReason, explainDecision } from './reasons.js';

export interface PolicyMandateState {
  mandateId: string; vendorId: string; currency: string;
  limit: bigint; perPaymentLimit?: bigint | undefined; periodCap?: bigint | undefined; periodDays?: number | undefined;
  startsAt: string; startsAtMs: number; expiresAt: string; expiresAtMs: number; revoked: boolean;
  /** Total settled so far. */
  settledTotal: bigint;
  /** Approved but not yet settled. */
  pendingTotal: bigint;
  /** Settled inside the period window containing `nowMs`. */
  settledInPeriod: bigint;
}
export interface PolicyDelegation { delegationId: string; mandateId: string; agentId: string }
export interface PolicyIntent {
  mandateId: string; delegationId: string; agentId: string; vendorId: string; currency: string; amount: bigint;
}
export interface PolicyEvaluation {
  decision: 'approved' | 'rejected';
  reasonCodes: ReasonCode[];
  primaryReasonCode: ReasonCode;
  /** Raw, machine-readable parameters (strings). Store these in PolicyDecisionRecorded. */
  reasonParams: Record<string, string>;
  /** One human-readable sentence per reason code. */
  reasons: string[];
  headline: string;
}

export function evaluateSpendIntent(args: {
  mandate: PolicyMandateState | undefined; delegation: PolicyDelegation | undefined; intent: PolicyIntent; nowMs: number;
}): PolicyEvaluation {
  const { mandate, delegation, intent, nowMs } = args;
  const params: Record<string, string> = {
    mandateId: intent.mandateId, delegationId: intent.delegationId, agentId: intent.agentId,
    amountMinor: intent.amount.toString(), currency: mandate?.currency ?? intent.currency,
    intentVendorId: intent.vendorId, intentCurrency: intent.currency,
  };
  const codes: ReasonCode[] = [];

  if (!mandate) {
    codes.push(ReasonCodes.MANDATE_NOT_FOUND);
    return finish('rejected', codes, params);
  }
  params['mandateVendorId'] = mandate.vendorId;
  params['mandateCurrency'] = mandate.currency;
  params['limitMinor'] = mandate.limit.toString();
  params['startsAt'] = mandate.startsAt;
  params['expiresAt'] = mandate.expiresAt;

  // Authority state
  if (mandate.revoked) codes.push(ReasonCodes.MANDATE_REVOKED);
  if (nowMs < mandate.startsAtMs) codes.push(ReasonCodes.MANDATE_NOT_STARTED);
  if (nowMs > mandate.expiresAtMs) codes.push(ReasonCodes.MANDATE_EXPIRED);
  if (!delegation || delegation.mandateId !== mandate.mandateId) codes.push(ReasonCodes.DELEGATION_NOT_FOUND);
  else if (delegation.agentId !== intent.agentId) codes.push(ReasonCodes.AGENT_NOT_DELEGATED);

  // Payment target
  if (intent.vendorId !== mandate.vendorId) codes.push(ReasonCodes.VENDOR_MISMATCH);
  const currencyOk = intent.currency === mandate.currency;
  if (!currencyOk) codes.push(ReasonCodes.CURRENCY_MISMATCH);
  const positive = intent.amount > 0n;
  if (!positive) codes.push(ReasonCodes.AMOUNT_NOT_POSITIVE);

  // Spend rules (only meaningful for a positive amount in the mandate currency)
  const remaining = mandate.limit - mandate.settledTotal - mandate.pendingTotal;
  const remainingClamped = remaining > 0n ? remaining : 0n;
  params['remainingMinor'] = remainingClamped.toString();
  if (positive && currencyOk) {
    if (mandate.perPaymentLimit !== undefined && intent.amount > mandate.perPaymentLimit) {
      params['perPaymentLimitMinor'] = mandate.perPaymentLimit.toString();
      codes.push(ReasonCodes.PER_PAYMENT_LIMIT_EXCEEDED);
    }
    if (mandate.periodCap !== undefined) {
      const projected = mandate.settledInPeriod + mandate.pendingTotal + intent.amount;
      if (projected > mandate.periodCap) {
        params['periodCapMinor'] = mandate.periodCap.toString();
        params['periodProjectedMinor'] = projected.toString();
        params['periodDays'] = String(mandate.periodDays ?? 0);
        codes.push(ReasonCodes.PERIOD_CAP_EXCEEDED);
      }
    }
    if (intent.amount > remainingClamped) codes.push(ReasonCodes.MANDATE_ALLOWANCE_EXCEEDED);
  }

  if (codes.length === 0) {
    params['remainingAfterMinor'] = (remainingClamped - intent.amount).toString();
    return finish('approved', [ReasonCodes.APPROVED_WITHIN_MANDATE], params);
  }
  return finish('rejected', codes, params);
}

function finish(decision: 'approved' | 'rejected', codes: ReasonCode[], params: Record<string, string>): PolicyEvaluation {
  const frozen: ReasonParams = params;
  return {
    decision, reasonCodes: codes, primaryReasonCode: codes[0] as ReasonCode, reasonParams: params,
    reasons: codes.map((c) => describeReason(c, frozen)), headline: explainDecision(decision, codes, frozen).headline,
  };
}

