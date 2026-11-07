import { computeRemaining } from '../allowance.js';
import { FluxFlowError } from '../errors.js';
import type { Clock, Commitment, NetworkId, TxSignature } from '../types.js';
import { LOCAL_NETWORK_ID, assertPositiveAmount, toAddress, type Address } from '../types.js';
import type {
  ChainReader,
  CreateFixedParams,
  CreateRecurringParams,
  DelegationClient,
  DelegationRef,
  DelegationState,
  MandateRecord,
  MandateRegistryClient,
  OpaqueSigner,
  PullParams,
  RemainingAllowance,
  SignatureStatus,
  SubmittedTransaction,
  TransferEvidence,
  WalletConnection,
} from '../interfaces.js';

/**
 * Deterministic in-memory environment for UI development and tests.
 * Simulates the *behaviour* of the Subscriptions program (caps, periods, expiry, revocation)
 * so FluxShell can run the golden demo without a validator. It is NOT the real program:
 * nothing here proves on-chain behaviour.
 */

/** Build a syntactically valid base58 mock address. Label must use base58 characters only. */
export function mockAddress(label: string): Address {
  return toAddress(`Mock${label}`.padEnd(44, '1'));
}

export function mockWallet(role: 'delegator' | 'delegatee', address: Address, network: NetworkId = LOCAL_NETWORK_ID): WalletConnection {
  return { role, address, network, signer: Object.freeze({}) as unknown as OpaqueSigner };
}

export interface FakeClock extends Clock {
  setMs(ms: number): void;
  advanceMs(ms: number): void;
  /** Block height advances ~1 per 400 ms of fake time. */
  blockHeight(): bigint;
}

export function createFakeClock(startMs = 1_800_000_000_000): FakeClock {
  let now = startMs;
  const origin = startMs;
  return {
    nowMs: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    setMs: (ms) => {
      now = ms;
    },
    advanceMs: (ms) => {
      now += ms;
    },
    blockHeight: () => 1_000n + BigInt(Math.floor((now - origin) / 400)),
  };
}

type Key = string;
const dkey = (r: DelegationRef): Key => `${r.kind}|${r.mint}|${r.delegator}|${r.delegatee}|${r.nonce}`;

export interface MockEnvironment {
  readonly network: NetworkId;
  readonly clock: FakeClock;
  readonly registry: MandateRegistryClient & { put(m: MandateRecord): void };
  readonly delegation: DelegationClient;
  readonly chain: ChainReader & {
    setBalance(owner: Address, mint: Address, amount: bigint): void;
    /** The next N RPC calls throw (simulating timeouts / outages). */
    failNextCalls(n: number): void;
    /** Transactions are accepted but never land (simulates a dropped transaction). */
    dropTransactions(on: boolean): void;
    setCommitment(c: Commitment): void;
    /** Overwrite recorded evidence to simulate a tampered/mismatched settlement. */
    tamperEvidence(signature: TxSignature, fn: (e: TransferEvidence) => TransferEvidence): void;
    /** Simulate Mainnet/Devnet mix-ups. */
    setReportedNetwork(n: NetworkId): void;
  };
  /** Total transactions "sent", for duplicate-submission assertions. */
  readonly sentCount: () => number;
  /** Make the NEXT pull return a signature that was already issued (replay simulation). */
  reuseLastSignatureOnNextPull(): void;
  /** Who the mock treats as the delegator when createFixed/createRecurring are called. */
  setDelegator(a: Address): void;
}

export function createMockEnvironment(network: NetworkId = LOCAL_NETWORK_ID): MockEnvironment {
  const clock = createFakeClock();
  const balances = new Map<string, bigint>();
  const delegations = new Map<Key, DelegationState>();
  const mandates = new Map<string, MandateRecord>();
  const statuses = new Map<TxSignature, SignatureStatus>();
  const evidence = new Map<TxSignature, TransferEvidence>();
  let counter = 0;
  let failCalls = 0;
  let drop = false;
  let commitment: Commitment = 'finalized';
  let reportedNetwork: NetworkId = network;
  let reuseSig = false;
  let lastSig: TxSignature | null = null;

  const bal = (o: string, m: string): bigint => balances.get(`${o}|${m}`) ?? 0n;
  const setBal = (o: string, m: string, v: bigint): void => void balances.set(`${o}|${m}`, v);
  const nowTs = (): bigint => BigInt(Math.floor(clock.nowMs() / 1000));

  function newSignature(): TxSignature {
    counter += 1;
    const body = counter.toString().replace(/0/g, 'z');
    return `MockSig${body}`.padEnd(88, '1') as TxSignature;
  }
  function maybeFail(): void {
    if (failCalls > 0) {
      failCalls -= 1;
      throw new FluxFlowError('RPC_TIMEOUT', 'Mock RPC failure.');
    }
  }
  const delegationAddress = (kind: string, nonce: bigint): Address =>
    toAddress(`MockDe1eg${kind === 'fixed' ? 'F' : 'R'}${nonce + 1n}`.padEnd(44, '1'));

  const registry = {
    put(m: MandateRecord): void {
      mandates.set(m.mandateId, m);
    },
    async getMandate(id: string): Promise<MandateRecord | null> {
      return mandates.get(id) ?? null;
    },
  };

  const chain: MockEnvironment['chain'] = {
    setBalance: (o, m, a) => setBal(o, m, a),
    failNextCalls: (n) => {
      failCalls = n;
    },
    dropTransactions: (on) => {
      drop = on;
    },
    setCommitment: (c) => {
      commitment = c;
    },
    tamperEvidence: (sig, fn) => {
      const e = evidence.get(sig);
      if (e) evidence.set(sig, fn(e));
    },
    setReportedNetwork: (n) => {
      reportedNetwork = n;
    },
    async getNetwork() {
      maybeFail();
      return reportedNetwork;
    },
    async getTokenBalance(owner, mint) {
      maybeFail();
      return bal(owner, mint);
    },
    async getSignatureStatus(sig) {
      maybeFail();
      return statuses.get(sig) ?? null;
    },
    async getBlockHeight() {
      maybeFail();
      return clock.blockHeight();
    },
    async getTransferEvidence(sig) {
      maybeFail();
      return evidence.get(sig) ?? null;
    },
  };

  const delegation: DelegationClient = {
    async createFixed(p: CreateFixedParams) {
      assertPositiveAmount(p.amount);
      if (p.expiryTs === 0n) throw new FluxFlowError('INVALID_REQUEST', 'FluxFlow refuses delegations without an expiry.');
      return createDelegation('fixed', p.mint, p.delegatee, p.nonce, { kind: 'fixed', remaining: p.amount, expiryTs: p.expiryTs });
    },
    async createRecurring(p: CreateRecurringParams) {
      assertPositiveAmount(p.amountPerPeriod, 'amountPerPeriod');
      assertPositiveAmount(p.periodLengthS, 'periodLengthS');
      if (p.expiryTs === 0n) throw new FluxFlowError('INVALID_REQUEST', 'FluxFlow refuses delegations without an expiry.');
      const start = p.startTs === 0n ? nowTs() : p.startTs;
      return createDelegation('recurring', p.mint, p.delegatee, p.nonce, {
        kind: 'recurring',
        amountPerPeriod: p.amountPerPeriod,
        amountPulledInPeriod: 0n,
        currentPeriodStartTs: start,
        periodLengthS: p.periodLengthS,
        expiryTs: p.expiryTs,
      });
    },
    async getState(ref) {
      return delegations.get(dkey(ref)) ?? null;
    },
    async getRemainingAllowance(ref, now): Promise<RemainingAllowance> {
      return computeRemaining(delegations.get(dkey(ref)) ?? null, now);
    },
    async revoke(ref): Promise<SubmittedTransaction> {
      if (!delegations.delete(dkey(ref))) throw new FluxFlowError('DELEGATION_REVOKED', 'Nothing to revoke.');
      return { signature: newSignature() };
    },
    async pull(p: PullParams): Promise<SubmittedTransaction> {
      assertPositiveAmount(p.amount);
      const state = delegations.get(dkey(p));
      const allowance = computeRemaining(state ?? null, nowTs());
      if (state === undefined || allowance.status !== 'active' || p.amount > allowance.remaining) {
        // Stands in for the Subscriptions program refusing the transfer.
        throw new FluxFlowError('PROGRAM_REJECTED', 'Mock program rejected the transfer.', { reason: allowance.status });
      }
      if (bal(p.delegator, p.mint) < p.amount) {
        throw new FluxFlowError('PROGRAM_REJECTED', 'Mock program rejected: insufficient funds.');
      }
      const signature = reuseSig && lastSig !== null ? lastSig : newSignature();
      reuseSig = false;
      lastSig = signature;
      sent += 1;
      const lastValidBlockHeight = clock.blockHeight() + 150n;
      if (drop) return { signature, lastValidBlockHeight };

      if (state.kind === 'fixed') {
        delegations.set(dkey(p), { ...state, remaining: state.remaining - p.amount });
      } else {
        const ended = nowTs() >= state.currentPeriodStartTs + state.periodLengthS;
        const base = ended ? 0n : state.amountPulledInPeriod;
        delegations.set(dkey(p), {
          ...state,
          currentPeriodStartTs: ended ? nowTs() : state.currentPeriodStartTs,
          amountPulledInPeriod: base + p.amount,
        });
      }
      setBal(p.delegator, p.mint, bal(p.delegator, p.mint) - p.amount);
      setBal(p.recipient, p.mint, bal(p.recipient, p.mint) + p.amount);
      statuses.set(signature, { confirmationStatus: commitment, err: null, slot: Number(clock.blockHeight()) + 10 });
      evidence.set(signature, {
        signature,
        slot: Number(clock.blockHeight()) + 10,
        err: null,
        balanceDeltas: [
          { owner: p.delegator, mint: p.mint, delta: -p.amount },
          { owner: p.recipient, mint: p.mint, delta: p.amount },
        ],
      });
      return { signature, lastValidBlockHeight };
    },
  };

  let sent = 0;
  let delegatorForCreates: Address | null = null;

  function createDelegation(
    kind: 'fixed' | 'recurring',
    mint: Address,
    delegatee: Address,
    nonce: bigint,
    state: DelegationState,
  ) {
    if (delegatorForCreates === null) {
      throw new FluxFlowError('INVALID_CONFIG', 'Call env-level setDelegator before creating mock delegations.');
    }
    delegations.set(dkey({ kind, mint, delegator: delegatorForCreates, delegatee, nonce }), state);
    return Promise.resolve({ signature: newSignature(), delegationAddress: delegationAddress(kind, nonce) });
  }

  const env: MockEnvironment = {
    network,
    clock,
    registry,
    delegation,
    chain,
    sentCount: () => sent,
    reuseLastSignatureOnNextPull: () => {
      reuseSig = true;
    },
    setDelegator: (a) => {
      delegatorForCreates = a;
    },
  };
  return env;
}

/** Convenience seed for UI development: one funded delegator, one fixed delegation, one approved mandate. */
export function seedMockDemo(env: MockEnvironment) {
  const delegator = mockAddress('Treasury');
  const delegatee = mockAddress('Agent');
  const vendor = mockAddress('Vendor');
  const mint = mockAddress('USDC');
  env.setDelegator(delegator);
  env.chain.setBalance(delegator, mint, 10_000_000n);
  const nowTs = BigInt(Math.floor(env.clock.nowMs() / 1000));
  return env.delegation
    .createFixed({ mint, delegatee, nonce: 0n, amount: 1_000_000n, expiryTs: nowTs + 86_400n })
    .then(() => {
      const mandate: MandateRecord = {
        mandateId: 'mandate-demo-1',
        contractId: 'contract-demo-1',
        obligationId: 'obligation-demo-1',
        agentId: 'agent-demo-1',
        network: env.network,
        mint,
        delegator,
        delegatee,
        allowedRecipients: [vendor],
        perPaymentCap: 500_000n,
        validFromTs: nowTs - 60n,
        expiresAtTs: nowTs + 86_400n,
        status: 'active',
        delegation: { kind: 'fixed', nonce: 0n },
        humanApprovalRef: 'approval-demo-1',
      };
      env.registry.put(mandate);
      return { mandate, delegator, delegatee, vendor, mint };
    });
}

