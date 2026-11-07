import { FluxFlowError } from '../errors.js';
import type { Address, NetworkId } from '../types.js';

/**
 * ROADMAP — INTERFACE ONLY. Nothing here is implemented or on the critical path.
 *
 * Basis: solana.com/docs/payments/agentic-payments/mpp describes MPP `charge` (one-time)
 * and `session` (metered: on-chain payment channel with a maximum deposit, then cumulative
 * signed vouchers settled later) intents, carried by HTTP 402 challenge / credential / receipt
 * exchanges. MPP is published as Internet-Drafts and may change.
 * Payment-channel program: github.com/solana-foundation/payment-channels.
 *
 * Roadmap requirements recorded for the future implementer:
 *  - persist channel state, accepted cumulative amount and settlement watermark in shared storage;
 *  - make reuse-check + consume atomic across instances;
 *  - treat the channel deposit as the hard spend cap and bind it to a FluxMandate.
 */
export interface MppSessionOpenParams {
  readonly network: NetworkId;
  readonly mint: Address;
  readonly recipient: Address;
  /** Maximum deposit in base units (the hard cap). */
  readonly maxDeposit: bigint;
  readonly mandateId: string;
}

export interface MppSessionHandle {
  readonly channelId: string;
  readonly maxDeposit: bigint;
}

export interface MppSessionAdapter {
  open(p: MppSessionOpenParams): Promise<MppSessionHandle>;
  /** Sign a cumulative voucher; amounts never decrease. */
  voucher(h: MppSessionHandle, cumulativeAmount: bigint): Promise<string>;
  settleAndClose(h: MppSessionHandle): Promise<{ settledAmount: bigint }>;
}

export function createMppSessionAdapter(): MppSessionAdapter {
  const notYet = (): never => {
    throw new FluxFlowError('NOT_IMPLEMENTED', 'MPP sessions / payment channels are roadmap-only in FluxFlow.');
  };
  return { open: async () => notYet(), voucher: async () => notYet(), settleAndClose: async () => notYet() };
}
