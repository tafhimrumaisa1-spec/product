import { FluxFlowError } from './errors.js';
import type { PaymentRequest } from './interfaces.js';
import { DEVNET_NETWORK_ID, toAddress, type NetworkId } from './types.js';

/** The policy-relevant fields from an x402 V2 `PaymentRequirements` object. */
export interface X402V2Requirement {
  readonly x402Version: 2;
  readonly scheme: 'exact';
  readonly network: string;
  readonly asset: string;
  /** Atomic token units, encoded as an unsigned decimal string. */
  readonly amount: string;
  readonly payTo: string;
  readonly resource?: string;
}

export interface X402MandateContext {
  readonly paymentId: string;
  readonly mandateId: string;
  readonly taskId: string;
  readonly agentId: string;
}

/**
 * Converts an x402 V2 challenge into the same PaymentRequest used by every
 * FluxFlow payment. This adapter does not trust or settle the challenge: the
 * normal executor still checks the human-approved mandate, network, mint,
 * recipient, cap, allowance, replay state and final chain evidence.
 */
export function x402V2ToPaymentRequest(
  requirement: X402V2Requirement,
  context: X402MandateContext,
): PaymentRequest {
  if (requirement.x402Version !== 2 || requirement.scheme !== 'exact') {
    throw new FluxFlowError('INVALID_REQUEST', 'Only the x402 V2 exact scheme is supported.');
  }
  if (requirement.network !== DEVNET_NETWORK_ID) {
    throw new FluxFlowError('UNSUPPORTED_NETWORK', 'The x402 requirement must target Solana Devnet.', {
      network: requirement.network,
    });
  }
  if (!/^[1-9][0-9]*$/.test(requirement.amount)) {
    throw new FluxFlowError('INVALID_AMOUNT', 'The x402 amount must be a positive atomic-unit integer string.');
  }

  return {
    ...context,
    network: requirement.network as NetworkId,
    mint: toAddress(requirement.asset),
    recipient: toAddress(requirement.payTo),
    amount: BigInt(requirement.amount),
  };
}
