import { FluxFlowError } from './errors.js';

export type Brand<T, B extends string> = T & { readonly __brand: B };

/** Base58 Solana address (validated shape only). */
export type Address = Brand<string, 'Address'>;
/** Base58 transaction signature (validated shape only). */
export type TxSignature = Brand<string, 'TxSignature'>;

/**
 * Networks FluxFlow will operate on. Mainnet is deliberately absent:
 * the product definition allows Devnet assets and synthetic data only.
 * Devnet uses the x402 V2 / CAIP-2 identifier, never a V1 network name.
 */
export const DEVNET_NETWORK_ID = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1' as const;
export const LOCAL_NETWORK_ID = 'local' as const;
export type NetworkId = typeof DEVNET_NETWORK_ID | typeof LOCAL_NETWORK_ID;

export type Commitment = 'processed' | 'confirmed' | 'finalized';
export type DelegationKind = 'fixed' | 'recurring';

const ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SIGNATURE_RE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

export function isAddress(v: string): v is Address {
  return ADDRESS_RE.test(v);
}

export function toAddress(v: string): Address {
  if (!isAddress(v)) {
    throw new FluxFlowError('INVALID_ADDRESS', 'Value is not a valid base58 Solana address.');
  }
  return v;
}

export function toSignature(v: string): TxSignature {
  if (!SIGNATURE_RE.test(v)) {
    throw new FluxFlowError('ADAPTER_CONTRACT', 'Value is not a valid base58 transaction signature.');
  }
  return v as TxSignature;
}

/** Positive base-unit amount (e.g. 1_000_000n = 1 token at 6 decimals). */
export function assertPositiveAmount(amount: bigint, label = 'amount'): void {
  if (typeof amount !== 'bigint' || amount <= 0n) {
    throw new FluxFlowError('INVALID_AMOUNT', `${label} must be a positive bigint in base units.`);
  }
}

/** Injectable time source so expiry logic is deterministic in tests. */
export interface Clock {
  nowMs(): number;
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
  nowMs: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export function unixSeconds(clock: Clock): bigint {
  return BigInt(Math.floor(clock.nowMs() / 1000));
}
