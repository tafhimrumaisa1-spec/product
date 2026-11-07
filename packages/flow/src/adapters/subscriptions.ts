import { computeRemaining } from '../allowance.js';
import { FluxFlowError, isFluxFlowError } from '../errors.js';
import type {
  CreateFixedParams,
  CreateRecurringParams,
  DelegationClient,
  DelegationRef,
  DelegationState,
  OpaqueSigner,
  PullParams,
  RemainingAllowance,
  SubmittedTransaction,
  WalletConnection,
} from '../interfaces.js';
import { assertPositiveAmount, toAddress, toSignature } from '../types.js';

/**
 * Adapter over `@solana/subscriptions` (solana-foundation/subscriptions).
 *
 * VERIFIED against official docs (solana.com/docs/payments/subscriptions/*):
 *   instruction builder names and parameter names, PDA helper names and arguments,
 *   `fetchMaybeSubscriptionAuthority(rpc, pda)`, `.sendTransaction()` chaining,
 *   delegator signs create/revoke, delegatee signs transfers, expiry/start in Unix seconds.
 *
 * NOT VERIFIABLE from the docs available to us (see ASSUMPTIONS.md):
 *   - the value returned by `sendTransaction()` (we accept a string or `{ signature }`;
 *     override with `extractSubmitted` if the real shape differs);
 *   - a single-delegation account fetch helper (inject `readers`);
 *   - program error names (any unclassified failure becomes PROGRAM_REJECTED / RPC_TIMEOUT).
 *
 * Types are structural so FluxFlow compiles without the SDK installed. Method-style
 * signatures keep parameter checking bivariant so Kit's branded `Address` types fit.
 */

export interface PlannedInstruction {
  sendTransaction(): Promise<unknown>;
}

export interface SubscriptionsInstructionsLike {
  initSubscriptionAuthority(a: { tokenMint: string; tokenProgram: string; userAta: string }): PlannedInstruction;
  createFixedDelegation(a: {
    tokenMint: string;
    delegatee: string;
    nonce: bigint;
    amount: bigint;
    expiryTs: bigint;
  }): PlannedInstruction;
  createRecurringDelegation(a: {
    tokenMint: string;
    delegatee: string;
    nonce: bigint;
    amountPerPeriod: bigint;
    periodLengthS: bigint;
    startTs: bigint;
    expiryTs: bigint;
  }): PlannedInstruction;
  transferFixed(a: TransferArgs): PlannedInstruction;
  transferRecurring(a: TransferArgs): PlannedInstruction;
  revokeDelegation(a: { authority: unknown; delegationAccount: string }): PlannedInstruction;
}

export interface TransferArgs {
  delegatee: unknown;
  delegator: string;
  delegatorAta: string;
  tokenMint: string;
  delegationPda: string;
  amount: bigint;
  receiverAta: string;
  tokenProgram: string;
}

/** A Kit client composed with `.use(signer(...)).use(solana…Rpc(...)).use(subscriptionsProgram())`. */
export interface SubscriptionsClientLike {
  readonly rpc: unknown;
  readonly subscriptions: { readonly instructions: SubscriptionsInstructionsLike };
}

export interface SubscriptionsSdkLike {
  /** `TOKEN_PROGRAM_ADDRESS` from `@solana-program/token` (SPL Token). */
  readonly tokenProgramAddress: string;
  findAssociatedTokenPda(a: { mint: string; owner: string; tokenProgram: string }): Promise<readonly [string, number]>;
  findSubscriptionAuthorityPda(a: { user: string; tokenMint: string }): Promise<readonly [string, number]>;
  findFixedDelegationPda(a: {
    subscriptionAuthority: string;
    delegator: string;
    delegatee: string;
    nonce: bigint;
  }): Promise<readonly [string, number]>;
  findRecurringDelegationPda(a: {
    subscriptionAuthority: string;
    delegator: string;
    delegatee: string;
    nonce: bigint;
  }): Promise<readonly [string, number]>;
  fetchMaybeSubscriptionAuthority(rpc: unknown, pda: string): Promise<{ readonly exists: boolean }>;
}

/** Decoded account fields; names follow the on-chain layout in docs/001-program-architecture.md. */
export interface DelegationAccountReaders {
  readFixed(pda: string): Promise<{ amount: bigint; expiryTs: bigint } | null>;
  readRecurring(pda: string): Promise<{
    amountPerPeriod: bigint;
    amountPulledInPeriod: bigint;
    currentPeriodStartTs: bigint;
    periodLengthS: bigint;
    expiryTs: bigint;
  } | null>;
}

export interface SubscriptionsAdapterOptions {
  readonly sdk: SubscriptionsSdkLike;
  /** Client whose fee payer/identity is the DELEGATOR (creates and revokes). */
  readonly delegatorClient: SubscriptionsClientLike;
  /** Client whose fee payer/identity is the DELEGATEE agent (pulls). Server-side only. */
  readonly agentClient: SubscriptionsClientLike;
  readonly delegatorWallet: WalletConnection;
  readonly agentWallet: WalletConnection;
  readonly readers: DelegationAccountReaders;
  /** Override if `sendTransaction()` resolves to something other than a string / `{ signature }`. */
  readonly extractSubmitted?: (result: unknown) => SubmittedTransaction;
}

function defaultExtract(result: unknown): SubmittedTransaction {
  const sig =
    typeof result === 'string'
      ? result
      : typeof result === 'object' && result !== null && typeof (result as { signature?: unknown }).signature === 'string'
        ? (result as { signature: string }).signature
        : undefined;
  if (sig === undefined) {
    throw new FluxFlowError('ADAPTER_CONTRACT', 'sendTransaction() result has no recognisable signature; supply extractSubmitted.');
  }
  const lv = (result as { lastValidBlockHeight?: unknown } | null)?.lastValidBlockHeight;
  return typeof lv === 'bigint' ? { signature: toSignature(sig), lastValidBlockHeight: lv } : { signature: toSignature(sig) };
}

function classify(e: unknown): FluxFlowError {
  if (isFluxFlowError(e)) return e;
  const name = e instanceof Error ? e.name : '';
  if (name === 'AbortError' || name === 'TimeoutError') {
    return new FluxFlowError('RPC_TIMEOUT', 'RPC request timed out; outcome unknown.');
  }
  const msg = e instanceof Error ? e.message.slice(0, 200) : 'unknown error';
  return new FluxFlowError('PROGRAM_REJECTED', 'Transaction was rejected before submission.', { cause: msg });
}

export function createSubscriptionsDelegationClient(opts: SubscriptionsAdapterOptions): DelegationClient {
  if (opts.delegatorWallet.role !== 'delegator' || opts.agentWallet.role !== 'delegatee') {
    throw new FluxFlowError('INVALID_CONFIG', 'Wallet roles must be delegator / delegatee.');
  }
  const { sdk } = opts;
  const extract = opts.extractSubmitted ?? defaultExtract;

  async function accounts(mint: string, delegator: string) {
    const [userAta] = await sdk.findAssociatedTokenPda({ mint, owner: delegator, tokenProgram: sdk.tokenProgramAddress });
    const [authority] = await sdk.findSubscriptionAuthorityPda({ user: delegator, tokenMint: mint });
    return { userAta, authority };
  }

  async function delegationPda(ref: DelegationRef): Promise<string> {
    const { authority } = await accounts(ref.mint, ref.delegator);
    const find = ref.kind === 'fixed' ? sdk.findFixedDelegationPda : sdk.findRecurringDelegationPda;
    const [pda] = await find.call(sdk, {
      subscriptionAuthority: authority,
      delegator: ref.delegator,
      delegatee: ref.delegatee,
      nonce: ref.nonce,
    });
    return pda;
  }

  async function ensureAuthority(mint: string): Promise<void> {
    const delegator = opts.delegatorWallet.address;
    const { userAta, authority } = await accounts(mint, delegator);
    const existing = await sdk.fetchMaybeSubscriptionAuthority(opts.delegatorClient.rpc, authority);
    if (!existing.exists) {
      await opts.delegatorClient.subscriptions.instructions
        .initSubscriptionAuthority({ tokenMint: mint, tokenProgram: sdk.tokenProgramAddress, userAta })
        .sendTransaction();
    }
  }

  async function guarded<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      throw classify(e);
    }
  }

  return {
    async createFixed(p: CreateFixedParams) {
      assertPositiveAmount(p.amount);
      if (p.expiryTs === 0n) throw new FluxFlowError('INVALID_REQUEST', 'FluxFlow refuses delegations without an expiry.');
      return guarded(async () => {
        await ensureAuthority(p.mint);
        const result = await opts.delegatorClient.subscriptions.instructions
          .createFixedDelegation({ tokenMint: p.mint, delegatee: p.delegatee, nonce: p.nonce, amount: p.amount, expiryTs: p.expiryTs })
          .sendTransaction();
        const pda = await delegationPda({ kind: 'fixed', mint: p.mint, delegator: opts.delegatorWallet.address, delegatee: p.delegatee, nonce: p.nonce });
        return { ...extract(result), delegationAddress: toAddress(pda) };
      });
    },

    async createRecurring(p: CreateRecurringParams) {
      assertPositiveAmount(p.amountPerPeriod, 'amountPerPeriod');
      assertPositiveAmount(p.periodLengthS, 'periodLengthS');
      if (p.expiryTs === 0n) throw new FluxFlowError('INVALID_REQUEST', 'FluxFlow refuses delegations without an expiry.');
      return guarded(async () => {
        await ensureAuthority(p.mint);
        const result = await opts.delegatorClient.subscriptions.instructions
          .createRecurringDelegation({
            tokenMint: p.mint,
            delegatee: p.delegatee,
            nonce: p.nonce,
            amountPerPeriod: p.amountPerPeriod,
            periodLengthS: p.periodLengthS,
            startTs: p.startTs,
            expiryTs: p.expiryTs,
          })
          .sendTransaction();
        const pda = await delegationPda({ kind: 'recurring', mint: p.mint, delegator: opts.delegatorWallet.address, delegatee: p.delegatee, nonce: p.nonce });
        return { ...extract(result), delegationAddress: toAddress(pda) };
      });
    },

    async getState(ref: DelegationRef): Promise<DelegationState | null> {
      return guarded(async () => {
        const pda = await delegationPda(ref);
        if (ref.kind === 'fixed') {
          const a = await opts.readers.readFixed(pda);
          return a === null ? null : { kind: 'fixed', remaining: a.amount, expiryTs: a.expiryTs };
        }
        const a = await opts.readers.readRecurring(pda);
        return a === null ? null : { kind: 'recurring', ...a };
      });
    },

    async getRemainingAllowance(ref: DelegationRef, nowTs: bigint): Promise<RemainingAllowance> {
      return computeRemaining(await this.getState(ref), nowTs);
    },

    async revoke(ref: DelegationRef): Promise<SubmittedTransaction> {
      return guarded(async () => {
        const pda = await delegationPda(ref);
        const result = await opts.delegatorClient.subscriptions.instructions
          .revokeDelegation({ authority: opts.delegatorWallet.signer as OpaqueSigner, delegationAccount: pda })
          .sendTransaction();
        return extract(result);
      });
    },

    async pull(p: PullParams): Promise<SubmittedTransaction> {
      assertPositiveAmount(p.amount);
      if (p.delegatee !== opts.agentWallet.address) {
        throw new FluxFlowError('WRONG_AGENT', 'Pull delegatee differs from the injected agent wallet.');
      }
      return guarded(async () => {
        const pda = await delegationPda(p);
        const { userAta } = await accounts(p.mint, p.delegator);
        const [receiverAta] = await sdk.findAssociatedTokenPda({ mint: p.mint, owner: p.recipient, tokenProgram: sdk.tokenProgramAddress });
        const args: TransferArgs = {
          delegatee: opts.agentWallet.signer,
          delegator: p.delegator,
          delegatorAta: userAta,
          tokenMint: p.mint,
          delegationPda: pda,
          amount: p.amount,
          receiverAta,
          tokenProgram: sdk.tokenProgramAddress,
        };
        const ix = opts.agentClient.subscriptions.instructions;
        const planned = p.kind === 'fixed' ? ix.transferFixed(args) : ix.transferRecurring(args);
        return extract(await planned.sendTransaction());
      });
    },
  };
}

