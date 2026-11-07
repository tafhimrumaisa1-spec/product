import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  createMppSessionAdapter,
  createSubscriptionsDelegationClient,
  mockAddress,
  mockWallet,
  type SubscriptionsClientLike,
  type SubscriptionsSdkLike,
} from '../src/index.js';
import { codeOf } from './fixtures.js';

/** Records calls so we can assert FluxFlow uses the documented builder names and argument names. */
function fakeSdkStack(sendResult: unknown = 'MockSig1'.padEnd(88, '1')) {
  const calls: Array<{ fn: string; args: object }> = [];
  const planned = (fn: string, args: object) => {
    calls.push({ fn, args });
    return { sendTransaction: async () => sendResult };
  };
  const ix = {
    initSubscriptionAuthority: (a: { tokenMint: string; tokenProgram: string; userAta: string }) => planned('initSubscriptionAuthority', a),
    createFixedDelegation: (a: Parameters<SubscriptionsClientLike['subscriptions']['instructions']['createFixedDelegation']>[0]) => planned('createFixedDelegation', a),
    createRecurringDelegation: (a: Parameters<SubscriptionsClientLike['subscriptions']['instructions']['createRecurringDelegation']>[0]) => planned('createRecurringDelegation', a),
    transferFixed: (a: Parameters<SubscriptionsClientLike['subscriptions']['instructions']['transferFixed']>[0]) => planned('transferFixed', a),
    transferRecurring: (a: Parameters<SubscriptionsClientLike['subscriptions']['instructions']['transferRecurring']>[0]) => planned('transferRecurring', a),
    revokeDelegation: (a: Parameters<SubscriptionsClientLike['subscriptions']['instructions']['revokeDelegation']>[0]) => planned('revokeDelegation', a),
  };
  const client: SubscriptionsClientLike = { rpc: {}, subscriptions: { instructions: ix } };
  const sdk: SubscriptionsSdkLike = {
    tokenProgramAddress: mockAddress('TokenProgram'),
    findAssociatedTokenPda: async ({ owner }) => [`ata-of-${owner}`, 255],
    findSubscriptionAuthorityPda: async ({ user }) => [`sa-of-${user}`, 255],
    findFixedDelegationPda: async ({ nonce }) => [mockAddress(`FixedPda${nonce + 1n}`), 255],
    findRecurringDelegationPda: async ({ nonce }) => [mockAddress(`RecPda${nonce + 1n}`), 255],
    fetchMaybeSubscriptionAuthority: async () => ({ exists: false }),
  };
  return { calls, client, sdk };
}

function build(sendResult?: unknown) {
  const { calls, client, sdk } = fakeSdkStack(sendResult);
  const delegator = mockWallet('delegator', mockAddress('Treasury'));
  const agent = mockWallet('delegatee', mockAddress('Agent'));
  const dc = createSubscriptionsDelegationClient({
    sdk,
    delegatorClient: client,
    agentClient: client,
    delegatorWallet: delegator,
    agentWallet: agent,
    readers: {
      readFixed: async () => ({ amount: 42n, expiryTs: 9_999n }),
      readRecurring: async () => null,
    },
  });
  return { calls, dc, delegator, agent };
}

describe('Subscriptions adapter (against a recording fake of the documented API shape)', () => {
  const mint = mockAddress('USDC');
  it('initialises the authority when missing, then creates a fixed delegation with documented argument names', async () => {
    const { calls, dc, agent } = build();
    const r = await dc.createFixed({ mint, delegatee: agent.address, nonce: 0n, amount: 1_000_000n, expiryTs: 5_000n });
    assert.deepEqual(calls.map((c) => c.fn), ['initSubscriptionAuthority', 'createFixedDelegation']);
    assert.deepEqual(Object.keys(calls[1]?.args ?? {}).sort(), ['amount', 'delegatee', 'expiryTs', 'nonce', 'tokenMint']);
    assert.ok(r.delegationAddress.length >= 32);
  });
  it('recurring creation uses amountPerPeriod / periodLengthS / startTs / expiryTs', async () => {
    const { calls, dc, agent } = build();
    await dc.createRecurring({ mint, delegatee: agent.address, nonce: 0n, amountPerPeriod: 10n, periodLengthS: 60n, startTs: 0n, expiryTs: 5_000n });
    assert.deepEqual(Object.keys(calls[1]?.args ?? {}).sort(), ['amountPerPeriod', 'delegatee', 'expiryTs', 'nonce', 'periodLengthS', 'startTs', 'tokenMint']);
  });
  it('pull uses transferFixed / transferRecurring with the delegatee signer and receiver ATA', async () => {
    const { calls, dc, delegator, agent } = build();
    const recipient = mockAddress('Vendor');
    await dc.pull({ kind: 'fixed', mint, delegator: delegator.address, delegatee: agent.address, nonce: 0n, recipient, amount: 5n });
    await dc.pull({ kind: 'recurring', mint, delegator: delegator.address, delegatee: agent.address, nonce: 0n, recipient, amount: 5n });
    assert.deepEqual(calls.map((c) => c.fn), ['transferFixed', 'transferRecurring']);
    const a = (calls[0]?.args ?? {}) as Record<string, unknown>;
    assert.equal(a['delegatee'], agent.signer);
    assert.equal(a['receiverAta'], `ata-of-${recipient}`);
    assert.equal(a['delegatorAta'], `ata-of-${delegator.address}`);
  });
  it('refuses to pull for a delegatee other than the injected agent', async () => {
    const { dc, delegator } = build();
    const code = await codeOf(dc.pull({ kind: 'fixed', mint, delegator: delegator.address, delegatee: mockAddress('Stranger'), nonce: 0n, recipient: mockAddress('Vendor'), amount: 5n }));
    assert.equal(code, 'WRONG_AGENT');
  });
  it('revoke passes the delegator signer and the delegation PDA', async () => {
    const { calls, dc, delegator, agent } = build();
    await dc.revoke({ kind: 'fixed', mint, delegator: delegator.address, delegatee: agent.address, nonce: 0n });
    const a = (calls[0]?.args ?? {}) as Record<string, unknown>;
    assert.equal(calls[0]?.fn, 'revokeDelegation');
    assert.equal(a['authority'], delegator.signer);
    assert.equal(typeof a['delegationAccount'], 'string');
  });
  it('maps reader output to allowance state; missing account means revoked', async () => {
    const { dc, delegator, agent } = build();
    const ref = { mint, delegator: delegator.address, delegatee: agent.address, nonce: 0n } as const;
    assert.equal((await dc.getRemainingAllowance({ ...ref, kind: 'fixed' }, 100n)).remaining, 42n);
    assert.equal((await dc.getRemainingAllowance({ ...ref, kind: 'recurring' }, 100n)).status, 'revoked');
  });
  it('fails loudly when sendTransaction returns an unrecognised shape', async () => {
    const { dc, agent } = build({ weird: true });
    assert.equal(await codeOf(dc.createFixed({ mint, delegatee: agent.address, nonce: 0n, amount: 1n, expiryTs: 5n })), 'ADAPTER_CONTRACT');
  });
  it('refuses unbounded delegations (expiryTs 0) at creation', async () => {
    const { dc, agent } = build();
    assert.equal(await codeOf(dc.createFixed({ mint, delegatee: agent.address, nonce: 0n, amount: 1n, expiryTs: 0n })), 'INVALID_REQUEST');
  });
});

describe('MPP roadmap adapter', () => {
  it('is interface-only: every method throws NOT_IMPLEMENTED', async () => {
    const a = createMppSessionAdapter();
    const h = { channelId: 'x', maxDeposit: 1n };
    assert.equal(await codeOf(a.open({ network: 'local', mint: mockAddress('USDC'), recipient: mockAddress('V'), maxDeposit: 1n, mandateId: 'm' })), 'NOT_IMPLEMENTED');
    assert.equal(await codeOf(a.voucher(h, 1n)), 'NOT_IMPLEMENTED');
    assert.equal(await codeOf(a.settleAndClose(h)), 'NOT_IMPLEMENTED');
  });
});

describe('source hygiene (security + compatibility guards)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, '..', 'src');
  const files = readdirSync(root, { recursive: true })
    .filter((f) => /\.(ts|json)$/.test(f) && !f.includes('node_modules'))
    .map((f) => ({ f, text: readFileSync(join(root, f), 'utf8') }));

  it('scans a non-trivial number of files', () => assert.ok(files.length >= 12));

  it('contains no embedded secrets, key material or NEXT_PUBLIC variables', () => {
    for (const { f, text } of files) {
      assert.ok(!/NEXT_PUBLIC/.test(text), `NEXT_PUBLIC in ${f}`);
      assert.ok(!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text), `PEM key in ${f}`);
      assert.ok(!/\[\s*\d{1,3}(\s*,\s*\d{1,3}){31,}\s*\]/.test(text), `keypair byte array in ${f}`);
      assert.ok(!/\b[1-9A-HJ-NP-Za-km-z]{80,90}\b/.test(text.replace(/padEnd\([^)]*\)/g, '')), `long base58 secret-like string in ${f}`);
    }
  });

  it('never generates or stores keys', () => {
    for (const { f, text } of files) {
      assert.ok(!/generateKeyPair|createKeyPairSigner|Keypair\.generate|process\.env/.test(text), `key handling in ${f}`);
    }
  });

  it('uses no x402 V1 headers or V1 network names, and no legacy web3.js', () => {
    for (const { f, text } of files) {
      assert.ok(!/X-PAYMENT/.test(text), `V1 header in ${f}`);
      assert.ok(!/['"]solana-(devnet|mainnet)['"]/.test(text), `V1 network name in ${f}`);
      assert.ok(!/@solana\/web3\.js|@solana\/spl-token['"]/.test(text), `legacy SDK import in ${f}`);
    }
  });
});
