import { FluxFlowError } from '../errors.js';
import type {
  BalanceDelta,
  ChainReader,
  SignatureStatus,
  TransferEvidence,
} from '../interfaces.js';
import {
  DEVNET_NETWORK_ID,
  LOCAL_NETWORK_ID,
  toAddress,
  type Address,
  type Commitment,
  type NetworkId,
  type TxSignature,
} from '../types.js';

/**
 * ChainReader over a Solana Kit RPC object (`createSolanaRpc(url)`).
 *
 * Documented basis: Kit README shows `rpc.<method>(...).send({ abortSignal })`
 * (github.com/anza-xyz/kit); method names are standard Solana JSON-RPC methods
 * (solana.com/docs/rpc). Confirmation semantics follow solana.com/docs/core/transactions/confirmation.
 *
 * NOT compiled against the real Kit types in this delivery (package could not be installed
 * offline); the structural types below are the minimal shape used. Verify at integration.
 */
interface Req<T> {
  send(opts?: { abortSignal?: AbortSignal }): Promise<T>;
}
interface ParsedTokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string };
}
export interface KitRpcLike {
  getSignatureStatuses(
    signatures: readonly string[],
  ): Req<{ value: ReadonlyArray<null | { slot: bigint | number; confirmationStatus?: string | null; err: unknown }> }>;
  getBlockHeight(config?: { commitment?: string }): Req<bigint | number>;
  getGenesisHash(): Req<string>;
  getTokenAccountBalance(address: string, config?: { commitment?: string }): Req<{ value: { amount: string } }>;
  getTransaction(
    signature: string,
    config: { encoding: 'jsonParsed'; maxSupportedTransactionVersion: 0; commitment?: string },
  ): Req<null | {
    slot: bigint | number;
    meta: null | {
      err: unknown;
      preTokenBalances?: readonly ParsedTokenBalance[] | null;
      postTokenBalances?: readonly ParsedTokenBalance[] | null;
    };
  }>;
}

export interface KitChainReaderOptions {
  readonly rpc: KitRpcLike;
  /** Derive the associated token account of (owner, mint), e.g. via `findAssociatedTokenPda`. */
  readonly deriveAta: (owner: Address, mint: Address) => Promise<string>;
  readonly rpcTimeoutMs?: number;
}

/** x402 V2 / MPP docs: the Mainnet CAIP-2 reference. FluxFlow refuses to run against it. */
const MAINNET_REF = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';

export function createKitChainReader(options: KitChainReaderOptions): ChainReader {
  const timeoutMs = options.rpcTimeoutMs ?? 10_000;

  async function call<T>(make: (signal: AbortSignal) => Promise<T>): Promise<T> {
    try {
      return await make(AbortSignal.timeout(timeoutMs));
    } catch {
      throw new FluxFlowError('RPC_TIMEOUT', 'RPC request failed or timed out.');
    }
  }

  return {
    async getNetwork(): Promise<NetworkId> {
      const hash = await call((s) => options.rpc.getGenesisHash().send({ abortSignal: s }));
      const ref = hash.slice(0, 32);
      if (ref === MAINNET_REF) {
        throw new FluxFlowError('UNSUPPORTED_NETWORK', 'Mainnet RPC detected; FluxFlow is Devnet/local only.');
      }
      return `solana:${ref}` === DEVNET_NETWORK_ID ? DEVNET_NETWORK_ID : LOCAL_NETWORK_ID;
    },

    async getTokenBalance(owner: Address, mint: Address): Promise<bigint> {
      const ata = await options.deriveAta(owner, mint);
      try {
        const res = await options.rpc.getTokenAccountBalance(ata).send({ abortSignal: AbortSignal.timeout(timeoutMs) });
        return BigInt(res.value.amount);
      } catch {
        // A missing token account and an RPC failure are indistinguishable here; surface as RPC failure.
        throw new FluxFlowError('RPC_TIMEOUT', 'Token balance lookup failed.');
      }
    },

    async getSignatureStatus(signature: TxSignature): Promise<SignatureStatus | null> {
      const res = await call((s) => options.rpc.getSignatureStatuses([signature]).send({ abortSignal: s }));
      const v = res.value[0];
      if (v === null || v === undefined) return null;
      const cs = v.confirmationStatus;
      const confirmationStatus: Commitment = cs === 'finalized' || cs === 'confirmed' ? cs : 'processed';
      return { confirmationStatus, err: v.err, slot: Number(v.slot) };
    },

    async getBlockHeight(commitment: Commitment): Promise<bigint> {
      const h = await call((s) => options.rpc.getBlockHeight({ commitment }).send({ abortSignal: s }));
      return BigInt(h);
    },

    async getTransferEvidence(signature: TxSignature): Promise<TransferEvidence | null> {
      const tx = await call((s) =>
        options.rpc
          .getTransaction(signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' })
          .send({ abortSignal: s }),
      );
      if (tx === null || tx.meta === null) return null;
      const pre = tx.meta.preTokenBalances ?? [];
      const post = tx.meta.postTokenBalances ?? [];
      const byIndex = new Map<number, { owner: string; mint: string; pre: bigint; post: bigint }>();
      for (const b of pre) {
        if (b.owner === undefined) continue;
        byIndex.set(b.accountIndex, { owner: b.owner, mint: b.mint, pre: BigInt(b.uiTokenAmount.amount), post: 0n });
      }
      for (const b of post) {
        if (b.owner === undefined) continue;
        const e = byIndex.get(b.accountIndex);
        if (e) e.post = BigInt(b.uiTokenAmount.amount);
        else byIndex.set(b.accountIndex, { owner: b.owner, mint: b.mint, pre: 0n, post: BigInt(b.uiTokenAmount.amount) });
      }
      const balanceDeltas: BalanceDelta[] = [...byIndex.values()].map((e) => ({
        owner: toAddress(e.owner),
        mint: toAddress(e.mint),
        delta: e.post - e.pre,
      }));
      return { signature, slot: Number(tx.slot), err: tx.meta.err, balanceDeltas };
    },
  };
}
