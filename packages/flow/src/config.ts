import { FluxFlowError } from './errors.js';
import {
  DEVNET_NETWORK_ID,
  LOCAL_NETWORK_ID,
  toAddress,
  type Address,
  type Commitment,
  type NetworkId,
} from './types.js';

/** Subscriptions & Allowances program (solana.com/docs/payments/subscriptions/overview). */
export const SUBSCRIPTIONS_PROGRAM_ID = toAddress('De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44');

/** Devnet USDC mint used in the official x402 sandbox example (solana.com/docs/payments/agentic-payments/x402). */
export const DEVNET_USDC_MINT = toAddress('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');

export interface FluxFlowConfig {
  readonly network: NetworkId;
  /** Server-side RPC URL. Must not embed credentials; supply provider tokens via server env at runtime. */
  readonly rpcUrl: string;
  /** Commitment a payment must reach before a receipt is issued. */
  readonly commitment: Commitment;
  /** Overall confirmation deadline. */
  readonly confirmTimeoutMs: number;
  readonly pollIntervalMs: number;
  readonly subscriptionsProgramId: Address;
  /** Mints FluxFlow is allowed to move. Anything else is rejected as WRONG_MINT. */
  readonly allowedMints: readonly Address[];
}

export interface ConfigOverrides {
  rpcUrl?: string;
  commitment?: Commitment;
  confirmTimeoutMs?: number;
  pollIntervalMs?: number;
  allowedMints?: readonly string[];
}

function finish(base: Omit<FluxFlowConfig, 'allowedMints'>, mints: readonly string[]): FluxFlowConfig {
  if (mints.length === 0) {
    throw new FluxFlowError('INVALID_CONFIG', 'At least one allowed mint is required.');
  }
  if (base.confirmTimeoutMs <= 0 || base.pollIntervalMs <= 0 || base.pollIntervalMs > base.confirmTimeoutMs) {
    throw new FluxFlowError('INVALID_CONFIG', 'Timeouts must be positive and pollIntervalMs <= confirmTimeoutMs.');
  }
  let url: URL;
  try {
    url = new URL(base.rpcUrl);
  } catch {
    throw new FluxFlowError('INVALID_CONFIG', 'rpcUrl is not a valid URL.');
  }
  if (url.username !== '' || url.password !== '') {
    throw new FluxFlowError('INVALID_CONFIG', 'rpcUrl must not embed credentials.');
  }
  if (base.network === DEVNET_NETWORK_ID && url.protocol !== 'https:') {
    throw new FluxFlowError('INVALID_CONFIG', 'Devnet rpcUrl must use https.');
  }
  return Object.freeze({ ...base, allowedMints: Object.freeze(mints.map(toAddress)) });
}

/** Local validator / Surfpool (default endpoint documented at solana.com/docs/payments/subscriptions/recurring-delegation). */
export function localConfig(overrides: ConfigOverrides = {}): FluxFlowConfig {
  return finish(
    {
      network: LOCAL_NETWORK_ID,
      rpcUrl: overrides.rpcUrl ?? 'http://127.0.0.1:8899',
      commitment: overrides.commitment ?? 'confirmed',
      confirmTimeoutMs: overrides.confirmTimeoutMs ?? 30_000,
      pollIntervalMs: overrides.pollIntervalMs ?? 500,
      subscriptionsProgramId: SUBSCRIPTIONS_PROGRAM_ID,
    },
    overrides.allowedMints ?? [],
  );
}

/** Devnet (public endpoint documented at solana.com/docs/payments/interacting-with-solana). */
export function devnetConfig(overrides: ConfigOverrides = {}): FluxFlowConfig {
  return finish(
    {
      network: DEVNET_NETWORK_ID,
      rpcUrl: overrides.rpcUrl ?? 'https://api.devnet.solana.com',
      commitment: overrides.commitment ?? 'confirmed',
      confirmTimeoutMs: overrides.confirmTimeoutMs ?? 60_000,
      pollIntervalMs: overrides.pollIntervalMs ?? 1_000,
      subscriptionsProgramId: SUBSCRIPTIONS_PROGRAM_ID,
    },
    overrides.allowedMints ?? [DEVNET_USDC_MINT],
  );
}

/** Narrowing guard for untrusted network strings (e.g. from an agent request). */
export function parseNetworkId(value: string): NetworkId {
  if (value === DEVNET_NETWORK_ID || value === LOCAL_NETWORK_ID) return value;
  throw new FluxFlowError('UNSUPPORTED_NETWORK', 'Only Devnet and local networks are supported.', {
    received: value.slice(0, 64),
  });
}
