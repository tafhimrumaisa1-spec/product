import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEVNET_NETWORK_ID } from '../src/index.js';
import { codeOf, mockAddress, setup } from './fixtures.js';

describe('PaymentExecutor: golden path', () => {
  it('pays within the mandate and issues a fully linked, verified receipt', async () => {
    const { executor, request, demo, env, store } = await setup();
    const receipt = await executor.execute(request());

    assert.equal(receipt.amount, '200000');
    assert.equal(receipt.recipient, demo.vendor);
    assert.equal(receipt.mint, demo.mint);
    assert.equal(receipt.network, env.network);
    assert.equal(receipt.commitment, 'finalized');
    assert.equal(receipt.verified, true);
    // linkage required by the golden demo (step 8): contract, obligation, mandate, agent, task
    assert.equal(receipt.contractId, 'contract-demo-1');
    assert.equal(receipt.obligationId, 'obligation-demo-1');
    assert.equal(receipt.mandateId, 'mandate-demo-1');
    assert.equal(receipt.agentId, 'agent-demo-1');
    assert.equal(receipt.taskId, 'task-1');
    assert.equal(receipt.humanApprovalRef, 'approval-demo-1');
    assert.equal(env.sentCount(), 1);
    assert.equal(await env.chain.getTokenBalance(demo.vendor, demo.mint), 200_000n);
    assert.equal((await store.get('pay-1'))?.signature, receipt.signature);
  });

  it('receipt is JSON-serialisable and contains no secret-looking fields', async () => {
    const { executor, request } = await setup();
    const json = JSON.stringify(await executor.execute(request()));
    assert.ok(!/secret|private|seed|mnemonic|keypair/i.test(json));
  });
});

describe('PaymentExecutor: golden demo step 7 (over-mandate payment rejected)', () => {
  it('rejects a payment above the per-payment cap and moves no funds', async () => {
    const { executor, request, env, demo } = await setup();
    assert.equal(await codeOf(executor.execute(request({ amount: 600_000n }))), 'CAP_EXCEEDED');
    assert.equal(env.sentCount(), 0);
    assert.equal(await env.chain.getTokenBalance(demo.vendor, demo.mint), 0n);
  });

  it('rejects when cumulative spend exceeds the delegated allowance', async () => {
    const { executor, request } = await setup();
    await executor.execute(request({ paymentId: 'a', amount: 500_000n }));
    await executor.execute(request({ paymentId: 'b', amount: 500_000n }));
    // 1,000,000 delegated, fully used
    assert.equal(await codeOf(executor.execute(request({ paymentId: 'c', amount: 1n }))), 'CAP_EXCEEDED');
  });
});

describe('PaymentExecutor: validation and error states', () => {
  it('insufficient balance', async () => {
    const { executor, request, env, demo } = await setup();
    env.chain.setBalance(demo.delegator, demo.mint, 100n);
    assert.equal(await codeOf(executor.execute(request())), 'INSUFFICIENT_BALANCE');
    assert.equal(env.sentCount(), 0);
  });

  it('wrong mint', async () => {
    const { executor, request } = await setup();
    assert.equal(await codeOf(executor.execute(request({ mint: mockAddress('Stranger') }))), 'WRONG_MINT');
  });

  it('wrong recipient', async () => {
    const { executor, request } = await setup();
    assert.equal(await codeOf(executor.execute(request({ recipient: mockAddress('Thief') }))), 'WRONG_RECIPIENT');
  });

  it('wrong network (request)', async () => {
    const { executor, request } = await setup();
    assert.equal(await codeOf(executor.execute(request({ network: DEVNET_NETWORK_ID }))), 'WRONG_NETWORK');
  });

  it('wrong network (RPC reports a different cluster)', async () => {
    const { executor, request, env } = await setup();
    env.chain.setReportedNetwork(DEVNET_NETWORK_ID);
    assert.equal(await codeOf(executor.execute(request())), 'WRONG_NETWORK');
  });

  it('mandate expiry', async () => {
    const { executor, request, env } = await setup();
    env.clock.advanceMs(2 * 86_400_000);
    assert.equal(await codeOf(executor.execute(request())), 'MANDATE_EXPIRED');
  });

  it('delegation expiry (mandate window still open)', async () => {
    const { executor, request, env, demo } = await setup();
    env.registry.put({ ...demo.mandate, expiresAtTs: demo.mandate.expiresAtTs + 10n * 86_400n });
    env.clock.advanceMs(2 * 86_400_000);
    assert.equal(await codeOf(executor.execute(request())), 'DELEGATION_EXPIRED');
  });

  it('revocation', async () => {
    const { executor, request, env, demo } = await setup();
    await env.delegation.revoke({ kind: 'fixed', mint: demo.mint, delegator: demo.delegator, delegatee: demo.delegatee, nonce: 0n });
    assert.equal(await codeOf(executor.execute(request())), 'DELEGATION_REVOKED');
  });

  it('mandate suspended / revoked / unapproved / unknown / wrong agent', async () => {
    const a = await setup({ status: 'suspended' });
    assert.equal(await codeOf(a.executor.execute(a.request())), 'MANDATE_NOT_ACTIVE');
    const b = await setup({ humanApprovalRef: '' });
    assert.equal(await codeOf(b.executor.execute(b.request())), 'MANDATE_NOT_APPROVED');
    const c = await setup();
    assert.equal(await codeOf(c.executor.execute(c.request({ mandateId: 'nope' }))), 'MANDATE_NOT_FOUND');
    const d = await setup();
    assert.equal(await codeOf(d.executor.execute(d.request({ agentId: 'someone-else' }))), 'WRONG_AGENT');
  });

  it('rejects malformed requests', async () => {
    const { executor, request } = await setup();
    assert.equal(await codeOf(executor.execute(request({ amount: 0n }))), 'INVALID_AMOUNT');
    assert.equal(await codeOf(executor.execute(request({ amount: -5n }))), 'INVALID_AMOUNT');
    assert.equal(await codeOf(executor.execute(request({ paymentId: ' ' }))), 'INVALID_REQUEST');
  });

  it('refuses to construct a real executor in a browser runtime', async () => {
    const { config, env, demo, store } = await setup();
    const { createPaymentExecutor, createSettlementVerifier, mockWallet } = await import('../src/index.js');
    (globalThis as { window?: unknown }).window = {};
    try {
      assert.throws(
        () =>
          createPaymentExecutor({
            config,
            registry: env.registry,
            delegation: env.delegation,
            chain: env.chain,
            store,
            verifier: createSettlementVerifier(env.chain),
            agentWallet: mockWallet('delegatee', demo.delegatee),
          }),
        (e) => (e as { code?: string }).code === 'BROWSER_SIGNER_FORBIDDEN',
      );
    } finally {
      delete (globalThis as { window?: unknown }).window;
    }
  });
});

describe('PaymentExecutor: replay and duplicate prevention', () => {
  it('rejects a repeated paymentId after success and sends only one transaction', async () => {
    const { executor, request, env } = await setup();
    await executor.execute(request());
    assert.equal(await codeOf(executor.execute(request())), 'REPLAY_DETECTED');
    assert.equal(env.sentCount(), 1);
  });

  it('rejects concurrent duplicates of the same paymentId', async () => {
    const { executor, request, env } = await setup();
    const [a, b] = await Promise.all([codeOf(executor.execute(request())), codeOf(executor.execute(request()))]);
    assert.deepEqual([a, b].sort(), ['NO_ERROR', 'REPLAY_DETECTED']);
    assert.equal(env.sentCount(), 1);
  });

  it('rejects a reused transaction signature under a different paymentId', async () => {
    const { executor, request, env } = await setup();
    await executor.execute(request({ paymentId: 'one' }));
    env.reuseLastSignatureOnNextPull();
    assert.equal(await codeOf(executor.execute(request({ paymentId: 'two' }))), 'REPLAY_DETECTED');
  });

  it('a failed pre-flight does not burn the paymentId', async () => {
    const { executor, request, env, demo } = await setup();
    env.chain.setBalance(demo.delegator, demo.mint, 0n);
    assert.equal(await codeOf(executor.execute(request())), 'INSUFFICIENT_BALANCE');
    env.chain.setBalance(demo.delegator, demo.mint, 1_000_000n);
    assert.equal(await codeOf(executor.execute(request())), 'NO_ERROR');
  });
});

describe('PaymentExecutor: confirmation failures', () => {
  it('RPC timeout during confirmation: outcome unknown, paymentId stays reserved', async () => {
    const { executor, request, env } = await setup();
    // pre-flight reads succeed; every confirmation poll then fails until the deadline
    env.chain.getSignatureStatus = async () => {
      throw new Error('rpc down');
    };
    assert.equal(await codeOf(executor.execute(request())), 'RPC_TIMEOUT');
    // must not be retryable blindly: the transaction may have landed
    assert.equal(await codeOf(executor.execute(request())), 'REPLAY_DETECTED');
    assert.equal(env.sentCount(), 1);
  });

  it('RPC outage before anything is sent releases the paymentId', async () => {
    const { executor, request, env } = await setup();
    env.chain.failNextCalls(1); // first pre-flight read (network) fails
    assert.equal(await codeOf(executor.execute(request())), 'RPC_TIMEOUT');
    assert.equal(env.sentCount(), 0);
    assert.equal(await codeOf(executor.execute(request())), 'NO_ERROR');
  });

  it('dropped transaction: blockhash expiry is detected and the paymentId is released', async () => {
    // 150 blocks * 400 ms = 60 s of fake time; give the confirmer 120 s to observe expiry
    const { executor, request, env } = await setup({}, { confirmTimeoutMs: 120_000, pollIntervalMs: 1_000 });
    env.chain.dropTransactions(true);
    assert.equal(await codeOf(executor.execute(request())), 'BLOCKHASH_EXPIRED');
    env.chain.dropTransactions(false);
    assert.equal(await codeOf(executor.execute(request())), 'NO_ERROR', 'released after provable non-settlement');
  });

  it('a dropped transaction that never expires within the deadline is RPC_TIMEOUT (unknown), still reserved', async () => {
    const { executor, request, env } = await setup({}, { confirmTimeoutMs: 5_000, pollIntervalMs: 500 });
    env.chain.dropTransactions(true);
    assert.equal(await codeOf(executor.execute(request())), 'RPC_TIMEOUT');
    assert.equal(await codeOf(executor.execute(request())), 'REPLAY_DETECTED');
  });

  it('settlement evidence that does not match the request is rejected and stays reserved', async () => {
    const { executor, request, env } = await setup();
    const original = env.chain.getTransferEvidence.bind(env.chain);
    env.chain.getTransferEvidence = async (sig) => {
      const e = await original(sig);
      return e === null ? null : { ...e, balanceDeltas: e.balanceDeltas.map((d) => (d.delta > 0n ? { ...d, delta: d.delta - 1n } : d)) };
    };
    assert.equal(await codeOf(executor.execute(request())), 'SETTLEMENT_MISMATCH');
    assert.equal(await codeOf(executor.execute(request())), 'REPLAY_DETECTED');
  });
});
