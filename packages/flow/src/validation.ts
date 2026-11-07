import type { FluxFlowConfig } from './config.js';
import { FluxFlowError } from './errors.js';
import type { MandateRecord, PaymentRequest, RemainingAllowance } from './interfaces.js';
import { assertPositiveAmount, type NetworkId } from './types.js';

export function validateRequestShape(req: PaymentRequest): void {
  for (const [k, v] of Object.entries({
    paymentId: req.paymentId,
    mandateId: req.mandateId,
    taskId: req.taskId,
    agentId: req.agentId,
  })) {
    if (typeof v !== 'string' || v.trim() === '' || v.length > 200) {
      throw new FluxFlowError('INVALID_REQUEST', `${k} must be a non-empty string up to 200 characters.`);
    }
  }
  assertPositiveAmount(req.amount);
}

export function validateNetwork(
  config: FluxFlowConfig,
  requested: NetworkId,
  mandate: MandateRecord,
  chainNetwork: NetworkId,
): void {
  const all = [requested, mandate.network, chainNetwork];
  if (all.some((n) => n !== config.network)) {
    throw new FluxFlowError('WRONG_NETWORK', 'Request, mandate, RPC endpoint and configuration must share one network.', {
      configured: config.network,
      requested,
      mandate: mandate.network,
      chain: chainNetwork,
    });
  }
}

export function validateMint(config: FluxFlowConfig, mandate: MandateRecord, req: PaymentRequest): void {
  if (req.mint !== mandate.mint || !config.allowedMints.includes(req.mint)) {
    throw new FluxFlowError('WRONG_MINT', 'Mint does not match the mandate or the configured allow-list.', {
      requested: req.mint,
      mandate: mandate.mint,
    });
  }
}

export function validateRecipient(mandate: MandateRecord, req: PaymentRequest): void {
  if (!mandate.allowedRecipients.includes(req.recipient)) {
    throw new FluxFlowError('WRONG_RECIPIENT', 'Recipient is not on the mandate allow-list.', {
      recipient: req.recipient,
    });
  }
}

export function validateMandate(mandate: MandateRecord, req: PaymentRequest, nowTs: bigint, agentDelegatee: string): void {
  if (mandate.humanApprovalRef.trim() === '') {
    throw new FluxFlowError('MANDATE_NOT_APPROVED', 'Mandate has no recorded human approval.', {
      mandateId: mandate.mandateId,
    });
  }
  if (mandate.status !== 'active') {
    throw new FluxFlowError('MANDATE_NOT_ACTIVE', `Mandate status is ${mandate.status}.`, { mandateId: mandate.mandateId });
  }
  if (mandate.agentId !== req.agentId || mandate.delegatee !== agentDelegatee) {
    throw new FluxFlowError('WRONG_AGENT', 'Agent identity does not match the mandate.', { mandateId: mandate.mandateId });
  }
  if (mandate.expiresAtTs === 0n || nowTs >= mandate.expiresAtTs || nowTs < mandate.validFromTs) {
    throw new FluxFlowError('MANDATE_EXPIRED', 'Mandate is outside its validity window.', { mandateId: mandate.mandateId });
  }
  if (req.amount > mandate.perPaymentCap) {
    throw new FluxFlowError('CAP_EXCEEDED', 'Amount exceeds the mandate per-payment cap.', {
      amount: req.amount.toString(),
      cap: mandate.perPaymentCap.toString(),
    });
  }
}

export function validateAllowance(allowance: RemainingAllowance, amount: bigint): void {
  switch (allowance.status) {
    case 'revoked':
      throw new FluxFlowError('DELEGATION_REVOKED', 'The delegation no longer exists (revoked).');
    case 'expired':
      throw new FluxFlowError('DELEGATION_EXPIRED', 'The delegation has expired.');
    case 'not_started':
      throw new FluxFlowError('DELEGATION_NOT_STARTED', 'The delegation period has not started.');
    case 'active':
      if (amount > allowance.remaining) {
        throw new FluxFlowError('CAP_EXCEEDED', 'Amount exceeds the remaining delegated allowance.', {
          amount: amount.toString(),
          remaining: allowance.remaining.toString(),
        });
      }
      return;
  }
}
