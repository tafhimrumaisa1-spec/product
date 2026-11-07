import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEVNET_NETWORK_ID,
  DEVNET_USDC_MINT,
  InMemoryReceiptStore,
  computeRemaining,
  createMockEnvironment,
  createSettlementVerifier,
  devnetConfig,
  localConfig,
  mockAddress,
  parseNetworkId,
  seedMockDemo,
  toAddress,
  type DelegationState,
  type SettlementReceipt,
  type TxSignature,
} from '../src/index.js';
import { codeOf } from './fixtures.js';

describe('config', () => {
  it('devnet defaults use the CAIP-2 id, https and the devnet USDC allow-list', () => {
    const c = devnetConfig();
    assert.equal(c.network, DEVNET_NETWORK_ID);
    assert.ok(c.rpcUrl.startsWith('https://'));
    assert.deepEqual([...c.allowedMints], [DEVNET_USDC_MINT]);
  });
  it('local config requires an explicit mint allow-list', () => {
    assert.throws(() => localConfig(), (e) => (e as { code?: string }).code === 'INVALID_CONFIG');
    assert.equal(localConfig({ allowedMints: [mockAddress('USDC')] }).rpcUrl, 'http://127.0.0.1:8899');
  });
  it('rejects credentials in RPC URLs, non-https devnet, bad timeouts', () => {
    assert.throws(() => devnetConfig({ rpcUrl: 'https://user:pw@example.com' }));
    assert.throws(() => devnetConfig({ rpcUrl: 'http://api.devnet.solana.com' }));
    assert.throws(() => devnetConfig({ pollIntervalMs: 5_000, confirmTimeoutMs: 1_000 }));
  });
  it('refuses mainnet and V1-style network names', () => {
    assert.throws(() => parseNetworkId('solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'), (e) => (e as { code?: string }).code === 'UNSUPPORTED_NETWORK');
    assert.throws(() => parseNetworkId('solana-devnet'));
    assert.equal(parseNetworkId(DEVNET_NETWORK_ID), DEVNET_NETWORK_ID);
  });
  it('validates addresses', () => {
    assert.throws(() => toAddress('not an address'));
  });
});

describe('remaining allowance (pure)', () => {
  const fixed = (remaining: bigint, expiryTs: bigint): DelegationState => ({ kind: 'fixed', remaining, expiryTs });
  const rec = (pulled: bigint, start = 1_000n): DelegationState => ({
    kind: 'recurring',
    amountPerPeriod: 100n,
    amountPulledInPeriod: pulled,
    currentPeriodStartTs: start,
    periodLengthS: 86_400n,
    expiryTs: 10_000_000n,
  });

  it('fixed: remaining, expiry, revoked', () => {
    assert.deepEqual(computeRemaining(fixed(70n, 5_000n), 100n), { status: 'active', remaining: 70n, expiryTs: 5_000n });
    assert.equal(computeRemaining(fixed(70n, 5_000n), 5_000n).status, 'expired');
    assert.equal(computeRemaining(fixed(70n, 0n), 999_999_999n).status, 'active'); // 0 = no expiry on-chain
    assert.equal(computeRemaining(null, 1n).status, 'revoked');
  });
  it('recurring: usage, reset at period boundary, not started, expiry', () => {
    assert.equal(computeRemaining(rec(30n), 2_000n).remaining, 70n);
    assert.equal(computeRemaining(rec(100n), 2_000n).remaining, 0n);
    assert.equal(computeRemaining(rec(100n), 1_000n + 86_400n).remaining, 100n); // new period
    assert.equal(computeRemaining(rec(0n, 5_000n), 1_000n).status, 'not_started');
    assert.equal(computeRemaining(rec(0n), 10_000_000n).status, 'expired');
  });
});

describe('mock delegation client (program behaviour stand-in)', () => {
  it('creates fixed + recurring delegations and refuses unbounded ones', async () => {
    const env = createMockEnvironment();
    const d = await seedMockDemo(env);
    const rec = await env.delegation.createRecurring({
      mint: d.mint, delegatee: d.delegatee, nonce: 1n, amountPerPeriod: 100n, periodLengthS: 60n, startTs: 0n,
      expiryTs: BigInt(Math.floor(env.clock.nowMs() / 1000)) + 3_600n,
    });
    assert.ok(rec.delegationAddress.length >= 32);
    await assert.rejects(
      () => env.delegation.createFixed({ mint: d.mint, delegatee: d.delegatee, nonce: 2n, amount: 5n, expiryTs: 0n }),
      (e) => (e as { code?: string }).code === 'INVALID_REQUEST',
    );
    assert.equal(await codeOf(env.delegation.createFixed({ mint: d.mint, delegatee: d.delegatee, nonce: 3n, amount: 0n, expiryTs: 99n })), 'INVALID_AMOUNT');
  });

  it('recurring allowance resets in the next period', async () => {
    const env = createMockEnvironment();
    const d = await seedMockDemo(env);
    const now = BigInt(Math.floor(env.clock.nowMs() / 1000));
    const ref = { kind: 'recurring', mint: d.mint, delegator: d.delegator, delegatee: d.delegatee, nonce: 1n } as const;
    await env.delegation.createRecurring({ mint: d.mint, delegatee: d.delegatee, nonce: 1n, amountPerPeriod: 100n, periodLengthS: 60n, startTs: 0n, expiryTs: now + 3_600n });
    await env.delegation.pull({ ...ref, recipient: d.vendor, amount: 100n });
    assert.equal(await codeOf(env.delegation.pull({ ...ref, recipient: d.vendor, amount: 1n })), 'PROGRAM_REJECTED');
    env.clock.advanceMs(61_000);
    await env.delegation.pull({ ...ref, recipient: d.vendor, amount: 100n });
    assert.equal((await env.delegation.getRemainingAllowance(ref, BigInt(Math.floor(env.clock.nowMs() / 1000)))).remaining, 0n);
  });

  it('program-level refusal even if pre-flight were bypassed: cap, expiry, revoke', async () => {
    const env = createMockEnvironment();
    const d = await seedMockDemo(env);
    const ref = { kind: 'fixed', mint: d.mint, delegator: d.delegator, delegatee: d.delegatee, nonce: 0n } as const;
    assert.equal(await codeOf(env.delegation.pull({ ...ref, recipient: d.vendor, amount: 1_000_001n })), 'PROGRAM_REJECTED');
    await env.delegation.revoke(ref);
    assert.equal(await codeOf(env.delegation.pull({ ...ref, recipient: d.vendor, amount: 1n })), 'PROGRAM_REJECTED');
  });
});

describe('ReceiptStore', () => {
  const sig = (n: string): TxSignature => `Sig${n}`.padEnd(88, '1') as TxSignature;
  it('enforces one paymentId, one signature, commit-after-submit', async () => {
    const s = new InMemoryReceiptStore();
    assert.equal(await s.reserve('p'), true);
    assert.equal(await s.reserve('p'), false);
    assert.equal(await s.markSubmitted('p', sig('A')), true);
    assert.equal(await s.reserve('q'), true);
    assert.equal(await s.markSubmitted('q', sig('A')), false);
    await assert.rejects(() => s.commit({ paymentId: 'q', signature: sig('A') } as SettlementReceipt));
    await s.release('q');
    assert.equal(await s.reserve('q'), true);
  });
});

describe('SettlementVerifier', () => {
  async function paid() {
    const env = createMockEnvironment();
    const d = await seedMockDemo(env);
    const ref = { kind: 'fixed', mint: d.mint, delegator: d.delegator, delegatee: d.delegatee, nonce: 0n } as const;
    const tx = await env.delegation.pull({ ...ref, recipient: d.vendor, amount: 100n });
    const expected = { signature: tx.signature, network: env.network, mint: d.mint, recipient: d.vendor, delegator: d.delegator, amount: 100n };
    return { env, d, tx, expected, verifier: createSettlementVerifier(env.chain) };
  }
  it('accepts matching evidence', async () => {
    const { verifier, expected } = await paid();
    assert.deepEqual(await verifier.verify(expected), { ok: true, failures: [] });
  });
  it('flags wrong recipient, wrong amount, wrong mint, wrong network, missing evidence', async () => {
    const { verifier, expected, env, d } = await paid();
    assert.ok((await verifier.verify({ ...expected, recipient: mockAddress('Thief') })).failures.includes('WRONG_RECIPIENT'));
    assert.ok((await verifier.verify({ ...expected, amount: 99n })).failures.includes('SETTLEMENT_MISMATCH'));
    assert.ok((await verifier.verify({ ...expected, mint: mockAddress('Stranger') })).failures.includes('WRONG_MINT'));
    assert.ok((await verifier.verify({ ...expected, network: DEVNET_NETWORK_ID })).failures.includes('WRONG_NETWORK'));
    assert.ok((await verifier.verify({ ...expected, signature: `Nope`.padEnd(88, '1') as TxSignature })).failures.includes('EVIDENCE_UNAVAILABLE'));
    env.chain.tamperEvidence(expected.signature, (e) => ({ ...e, err: { InstructionError: [0, 'x'] } }));
    assert.ok((await verifier.verify(expected)).failures.includes('TX_FAILED'));
    void d;
  });
});
