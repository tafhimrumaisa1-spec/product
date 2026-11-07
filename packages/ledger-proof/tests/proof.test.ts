import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type AuditEvent, FIXTURE_IDS, PROOF_STEP_ORDER, ProofError, ReasonCodes, buildFixture, buildProofTrace, renderTraceText, syntheticSignature, toMinor,
} from '../source/index.js';
import { replay, strip } from './helpers.js';

const I = FIXTURE_IDS;

test('success trace walks all 12 links in the required order and is complete', async () => {
  const f = await buildFixture('success');
  const t = buildProofTrace(f.events, { intentId: f.intentId });
  assert.deepEqual(t.steps.map((s) => s.kind), [...PROOF_STEP_ORDER]);
  assert.deepEqual(t.steps.map((s) => s.kind), [
    'contract', 'contract_version', 'evidence_clause', 'approved_obligation', 'twin_scenario', 'mandate',
    'delegation', 'spend_intent', 'policy_decision', 'solana_transaction', 'settlement', 'ledger_entry',
  ]);
  assert.ok(t.steps.every((s) => s.status === 'present'), JSON.stringify(t.gaps));
  assert.equal(t.complete, true);
  assert.equal(t.outcome, 'settled');
  assert.equal(t.integrity.ok, true);
  assert.equal(t.steps.find((s) => s.kind === 'evidence_clause')?.entries.length, 3);
  assert.match(t.headline, /^Settled 1,000\.00 USDC to Acme Compute Services \(synthetic\) for task task_train_batch_42 by agent agent_compute_buyer under mandate mdt_acme_compute_q4\.$/);

  const tx = t.steps.find((s) => s.kind === 'solana_transaction')?.entries[0];
  assert.match(tx?.explorerUrl ?? '', /^https:\/\/explorer\.solana\.com\/tx\/[1-9A-HJ-NP-Za-km-z]{64,90}\?cluster=devnet$/);
  const mandateEntry = t.steps.find((s) => s.kind === 'mandate')?.entries[0];
  assert.match(mandateEntry?.explorerUrl ?? '', /\/address\/.+\?cluster=devnet$/);
  // every present entry points back to a real audit event
  for (const s of t.steps) for (const e of s.entries) assert.ok(e.eventId !== null && e.sequence !== null, `${s.kind} entry has event ref`);
});

test('trace can be requested by settlement id and yields the same trace', async () => {
  const f = await buildFixture('success');
  assert.deepEqual(buildProofTrace(f.events, { settlementId: 'stl_int_0001' }), buildProofTrace(f.events, { intentId: 'int_0001' }));
});

test('localnet explorer links use the custom RPC', async () => {
  const f = await buildFixture('success');
  const { events } = await replay(f.events, { map: (e) => {
    if (e.type === 'TransactionSubmitted') return { ...e, payload: { ...e.payload, cluster: 'localnet' } };
    if (e.type === 'SettlementConfirmed') return { ...e, payload: { ...e.payload, cluster: 'localnet' } };
    return e;
  } });
  const t = buildProofTrace(events, { intentId: 'int_0001' }, { explorer: { localnetRpcUrl: 'http://localhost:8899' } });
  assert.match(t.steps.find((s) => s.kind === 'solana_transaction')?.entries[0]?.explorerUrl ?? '', /\?cluster=custom&customUrl=http%3A%2F%2Flocalhost%3A8899$/);
});

test('over-limit trace explains the rejection and marks on-chain steps not applicable', async () => {
  const f = await buildFixture('over_limit');
  const t = buildProofTrace(f.events, { intentId: f.intentId });
  assert.equal(t.outcome, 'rejected');
  assert.equal(t.complete, true);
  const decision = t.steps.find((s) => s.kind === 'policy_decision');
  assert.deepEqual(decision?.reasonCodes, [ReasonCodes.PER_PAYMENT_LIMIT_EXCEEDED, ReasonCodes.PERIOD_CAP_EXCEEDED]);
  assert.match(decision?.reasons?.[0] ?? '', /3,500\.00 USDC exceeds the per-payment limit of 2,500\.00 USDC/);
  assert.match(decision?.reasons?.[1] ?? '', /4,500\.00 USDC, above the cap of 4,000\.00 USDC/);
  for (const k of ['solana_transaction', 'settlement', 'ledger_entry'] as const) assert.equal(t.steps.find((s) => s.kind === k)?.status, 'not_applicable');
  assert.match(t.headline, /^Rejected 3,500\.00 USDC payment to vendor_acme_compute by agent agent_compute_buyer: Per-payment limit exceeded; Periodic cap exceeded\.$/);
});

test('revoked-mandate trace shows the revocation entry and reason', async () => {
  const f = await buildFixture('revoked_mandate');
  const t = buildProofTrace(f.events, { intentId: f.intentId });
  assert.equal(t.steps.find((s) => s.kind === 'mandate')?.entries.length, 2);
  assert.match(t.steps.find((s) => s.kind === 'mandate')?.entries[1]?.summary ?? '', /revoked by a human/);
  assert.deepEqual(t.steps.find((s) => s.kind === 'policy_decision')?.reasonCodes, [ReasonCodes.MANDATE_REVOKED]);
  assert.match(t.steps.find((s) => s.kind === 'policy_decision')?.reasons?.[0] ?? '', /revoked by a human/);
});

test('mismatched-vendor trace names both vendors', async () => {
  const f = await buildFixture('mismatched_vendor');
  const t = buildProofTrace(f.events, { intentId: f.intentId });
  assert.deepEqual(t.steps.find((s) => s.kind === 'policy_decision')?.reasonCodes, [ReasonCodes.VENDOR_MISMATCH]);
  assert.match(t.steps.find((s) => s.kind === 'policy_decision')?.reasons?.[0] ?? '', /vendor_unlisted_gpu.*vendor_acme_compute/);
});

test('privacy levels: internal > auditor > public', async () => {
  const f = await buildFixture('success');
  const dump = (p: 'internal' | 'auditor' | 'public') => JSON.stringify(buildProofTrace(f.events, { intentId: 'int_0001' }, { privacy: p }));
  const internal = dump('internal'), auditor = dump('auditor'), pub = dump('public');
  assert.ok(internal.includes('Customer shall pay Provider'), 'internal keeps clause excerpt');
  assert.ok(!auditor.includes('Customer shall pay Provider'), 'auditor hides clause excerpt');
  assert.ok(auditor.includes('Acme Compute Services') && auditor.includes('human:finance_lead_01'));
  for (const secret of ['Acme Compute Services', 'Compute Services Agreement', 'finance_lead_01', 'Reserve GPU hours', 'GPU compute services, Nov', 'Customer shall pay Provider']) {
    assert.ok(!pub.includes(secret), `public trace leaks "${secret}"`);
  }
  assert.ok(pub.includes('[REDACTED]'));
  assert.ok(pub.includes('vendor_acme_compute'), 'ids stay visible');
  assert.ok(pub.includes('documentCommitment'), 'commitments stay visible');
});

test('tampered log is flagged and the trace is not complete', async () => {
  const f = await buildFixture('success');
  const tampered: AuditEvent[] = f.events.map((e) => (e.type === 'SettlementConfirmed' ? ({ ...e, payload: { ...e.payload, amountMinor: '1' } } as AuditEvent) : e));
  const t = buildProofTrace(tampered, { intentId: 'int_0001' });
  assert.equal(t.integrity.ok, false);
  assert.equal(t.complete, false);
  assert.ok(t.gaps.some((g) => g.startsWith('Audit log integrity')));
});

test('missing upstream records surface as gaps instead of being invented', async () => {
  const f = await buildFixture('success');
  const { events } = await replay(f.events, { keep: (e) => e.type !== 'ContractRegistered' && e.type !== 'TwinScenarioRecorded' });
  const t = buildProofTrace(events, { intentId: 'int_0001' });
  assert.equal(t.complete, false);
  assert.equal(t.steps.find((s) => s.kind === 'contract')?.status, 'missing');
  assert.equal(t.steps.find((s) => s.kind === 'twin_scenario')?.status, 'missing');
  assert.ok(t.gaps.some((g) => g.startsWith('Contract:')) && t.gaps.some((g) => g.startsWith('Twin scenario:')));
  assert.match(t.headline, /to vendor_acme_compute for task/, 'falls back to vendor id when the contract name is unknown');
});

test('quarantined duplicate settlements are reported but never used as evidence', async () => {
  const f = await buildFixture('success');
  const { store, events } = await replay(f.events);
  const original = events.find((e) => e.type === 'SettlementConfirmed') as AuditEvent;
  const input = strip(original);
  if (input.type !== 'SettlementConfirmed') throw new Error('unreachable');
  await store.append({ ...input, eventId: 'dup_x', payload: { ...input.payload, settlementId: 'stl_dup', signature: syntheticSignature('dup') } });
  const t = buildProofTrace([...(await store.readFrom(0))], { intentId: 'int_0001' });
  assert.equal(t.complete, true);
  assert.equal(t.steps.find((s) => s.kind === 'settlement')?.entries[0]?.eventId, original.eventId);
  assert.deepEqual(t.anomalies.map((a) => a.code), [ReasonCodes.DUPLICATE_SETTLEMENT_INTENT]);
  assert.match(renderTraceText(t), /! DUPLICATE_SETTLEMENT_INTENT/);
});

test('mandate approved by a non-human is never presented as evidence', async () => {
  const f = await buildFixture('success');
  const { events } = await replay(f.events, { map: (e) => (e.type === 'MandateCreated' ? { ...e, payload: { ...e.payload, approvedBy: 'agent:rogue' } } : e) });
  const t = buildProofTrace(events, { intentId: 'int_0001' });
  assert.equal(t.steps.find((s) => s.kind === 'mandate')?.status, 'missing');
  assert.equal(t.complete, false);
});

test('approved but unsettled and failed outcomes', async () => {
  const f = await buildFixture('success');
  const pending = (await replay(f.events, { keep: (e) => e.type !== 'SettlementConfirmed' })).events;
  const t1 = buildProofTrace(pending, { intentId: 'int_0001' });
  assert.equal(t1.outcome, 'approved_pending_settlement');
  assert.equal(t1.steps.find((s) => s.kind === 'solana_transaction')?.status, 'present');
  assert.equal(t1.steps.find((s) => s.kind === 'settlement')?.status, 'missing');
  assert.equal(t1.complete, false);

  const { store } = await replay(pending);
  await store.append({ eventId: 'fail_1', type: 'SettlementFailed', occurredAt: '2026-11-07T10:02:00Z', schemaVersion: 1, payload: { intentId: 'int_0001', reasonText: 'blockhash expired', failedAt: '2026-11-07T10:02:00Z' } });
  const failed = buildProofTrace([...(await store.readFrom(0))], { intentId: 'int_0001' });
  assert.equal(failed.outcome, 'failed');
  assert.match(failed.steps.find((s) => s.kind === 'settlement')?.note ?? '', /blockhash expired/);
  const pubFailed = buildProofTrace([...(await store.readFrom(0))], { intentId: 'int_0001' }, { privacy: 'public' });
  assert.ok(!(pubFailed.steps.find((s) => s.kind === 'settlement')?.note ?? '').includes('blockhash'));
});

test('query errors', async () => {
  const f = await buildFixture('success');
  assert.throws(() => buildProofTrace(f.events, {}), (e: unknown) => e instanceof ProofError && e.code === 'BAD_QUERY');
  assert.throws(() => buildProofTrace(f.events, { intentId: 'nope' }), (e: unknown) => e instanceof ProofError && e.code === 'NOT_FOUND');
  assert.throws(() => buildProofTrace(f.events, { settlementId: 'nope' }), (e: unknown) => e instanceof ProofError && e.code === 'NOT_FOUND');
});

test('renderTraceText is stable and readable', async () => {
  const f = await buildFixture('over_limit');
  const text = renderTraceText(buildProofTrace(f.events, { intentId: f.intentId }));
  assert.match(text, /9\. Policy decision \[present\]/);
  assert.match(text, /10\. Solana transaction \[not_applicable\]/);
  assert.match(text, /Trace complete\.$/);
  assert.equal(text, renderTraceText(buildProofTrace(f.events, { intentId: f.intentId })));
  void I; void toMinor;
});
