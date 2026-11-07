import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type AuditEvent, type AuditEventInput, FIXTURE_IDS, FIXTURE_NAMES, InMemoryEventStore, LedgerConsumer, LedgerError, LedgerProjection,
  ReasonCodes, buildFixture, rebuildLedger, syntheticSignature, toMinor,
} from '../source/index.js';
import { NOW, replay, strip } from './helpers.js';

const I = FIXTURE_IDS;
const usdc = toMinor;

// ───────── Fixtures ─────────

test('success fixture: every projection is correct', async () => {
  const f = await buildFixture('success');
  const snap = rebuildLedger(f.events).snapshot(NOW);

  assert.deepEqual(snap.agentSpend, [{ agentId: I.agentId, settledMinor: usdc('1000'), pendingMinor: '0', settlementCount: 1 }]);
  assert.deepEqual(snap.vendorExpense, [{ vendorId: I.vendorId, settledMinor: usdc('1000'), settlementCount: 1 }]);

  const [ob] = snap.contractObligations;
  assert.equal(ob?.totalMinor, usdc('12000'));
  assert.equal(ob?.settledMinor, usdc('1000'));
  assert.equal(ob?.remainingMinor, usdc('11000'));
  assert.equal(ob?.status, 'approved');
  assert.deepEqual(ob?.mandateIds, [I.mandateId]);

  const [st] = snap.settlements;
  assert.equal(st?.settlementId, 'stl_int_0001');
  assert.equal(st?.taskId, I.taskId);
  assert.equal(st?.cluster, 'devnet');
  assert.equal(st?.ledgerEntryId, 'le_stl_int_0001');

  assert.deepEqual(snap.taskEconomics, [{
    taskId: I.taskId, costMinor: usdc('1000'), revenueMinor: usdc('1800'), marginMinor: usdc('800'), marginBps: 4444, settlementCount: 1,
  }]);

  const [m] = snap.mandates;
  assert.equal(m?.remainingMinor, usdc('11000'));
  assert.equal(m?.pendingMinor, '0');
  assert.equal(m?.periodRemainingMinor, usdc('3000'));
  assert.equal(m?.status, 'active');

  const [entry] = snap.ledgerEntries;
  assert.equal(entry?.debitAccount, `expense:vendor:${I.vendorId}`);
  assert.equal(entry?.creditAccount, 'treasury:USDC');
  assert.equal(entry?.contractId, I.contractId);
  assert.equal(entry?.obligationId, I.obligationId);
  assert.equal(entry?.mandateId, I.mandateId);
  assert.equal(entry?.agentId, I.agentId);
  assert.equal(snap.anomalies.length, 0);
  assert.equal(snap.intents[0]?.status, 'settled');
});

test('period window rolls over: allowance resets in the next 30-day window', async () => {
  const f = await buildFixture('success');
  const p = rebuildLedger(f.events);
  assert.equal(p.mandateAllowance(I.mandateId, '2026-12-02T00:00:00Z')?.periodRemainingMinor, usdc('4000'));
  assert.equal(p.mandateAllowance(I.mandateId, '2026-11-30T23:59:59Z')?.periodRemainingMinor, usdc('3000'));
  assert.equal(p.mandateAllowance('nope'), undefined);
});

test('over-limit fixture: rejected with codes + human reasons; allowance and spend untouched', async () => {
  const f = await buildFixture('over_limit');
  const p = rebuildLedger(f.events);
  const rejected = p.intentViews().find((i) => i.intentId === 'int_0002');
  assert.equal(rejected?.status, 'rejected');
  assert.deepEqual(rejected?.reasonCodes, [ReasonCodes.PER_PAYMENT_LIMIT_EXCEEDED, ReasonCodes.PERIOD_CAP_EXCEEDED]);
  assert.equal(p.settlements().length, 1);
  assert.equal(p.vendorExpense()[0]?.settledMinor, usdc('1000'));
  assert.equal(p.mandateAllowance(I.mandateId)?.remainingMinor, usdc('11000'));
  assert.equal(p.mandateAllowance(I.mandateId)?.pendingMinor, '0');

  const decision = f.events.find((e) => e.type === 'PolicyDecisionRecorded' && e.payload.intentId === 'int_0002');
  assert.ok(decision && decision.type === 'PolicyDecisionRecorded');
  assert.equal(decision.payload.decision, 'rejected');
  assert.equal(decision.payload.reasonParams?.['perPaymentLimitMinor'], usdc('2500'));
  assert.equal(decision.payload.reasonParams?.['periodProjectedMinor'], usdc('4500'));
});

test('revoked-mandate fixture', async () => {
  const f = await buildFixture('revoked_mandate');
  const p = rebuildLedger(f.events);
  assert.equal(p.mandateAllowance(I.mandateId)?.status, 'revoked');
  assert.equal(p.mandateAllowance(I.mandateId)?.revokedAt, '2026-11-05T08:00:00Z');
  assert.deepEqual(p.intentViews()[0]?.reasonCodes, [ReasonCodes.MANDATE_REVOKED]);
  assert.equal(p.settlements().length, 0);
});

test('mismatched-vendor fixture', async () => {
  const f = await buildFixture('mismatched_vendor');
  const p = rebuildLedger(f.events);
  assert.deepEqual(p.intentViews()[0]?.reasonCodes, [ReasonCodes.VENDOR_MISMATCH]);
  assert.equal(p.vendorExpense().length, 0);
  assert.equal(p.agentSpend().length, 0);
});

test('all fixtures match their declared expectations and are deterministic', async () => {
  for (const name of FIXTURE_NAMES) {
    const a = await buildFixture(name);
    const b = await buildFixture(name);
    assert.deepEqual(a.events, b.events, `${name} deterministic`);
    const p = rebuildLedger(a.events);
    const intent = p.intentViews().find((i) => i.intentId === a.intentId);
    assert.ok(intent, name);
    assert.equal(intent.status === 'settled' ? 'settled' : intent.status, a.expected.outcome, name);
    assert.deepEqual(intent.reasonCodes, a.expected.reasonCodes, name);
    assert.equal(p.anomalies().length, 0, `${name} has no anomalies`);
  }
});

test('evaluateIntent reference policy covers unknown mandate/delegation/agent/currency/amount/expiry', async () => {
  const f = await buildFixture('success');
  const p = rebuildLedger(f.events);
  const base: { mandateId: string; delegationId: string; agentId: string; vendorId: string; currency: string; amountMinor: string } =
    { mandateId: I.mandateId, delegationId: I.delegationId, agentId: I.agentId, vendorId: I.vendorId, currency: 'USDC', amountMinor: usdc('100') };
  const ev = (o: Partial<typeof base>, at = NOW) => p.evaluateIntent({ ...base, ...o }, at).reasonCodes;
  assert.deepEqual(ev({}), [ReasonCodes.APPROVED_WITHIN_MANDATE]);
  assert.deepEqual(ev({ mandateId: 'ghost' }), [ReasonCodes.MANDATE_NOT_FOUND]);
  assert.deepEqual(ev({ delegationId: 'ghost' }), [ReasonCodes.DELEGATION_NOT_FOUND]);
  assert.deepEqual(ev({ agentId: 'agent_other' }), [ReasonCodes.AGENT_NOT_DELEGATED]);
  assert.deepEqual(ev({ currency: 'SOL' }), [ReasonCodes.CURRENCY_MISMATCH]);
  assert.deepEqual(ev({ amountMinor: '0' }), [ReasonCodes.AMOUNT_NOT_POSITIVE]);
  assert.deepEqual(ev({}, '2027-02-01T00:00:00Z'), [ReasonCodes.MANDATE_EXPIRED]);
  assert.deepEqual(ev({}, '2026-10-31T00:00:00Z'), [ReasonCodes.MANDATE_NOT_STARTED]);
  // total allowance: 11,000 remaining but per-payment limit also trips for 11,500
  const codes = ev({ amountMinor: usdc('11500') });
  assert.ok(codes.includes(ReasonCodes.MANDATE_ALLOWANCE_EXCEEDED));
  assert.ok(codes.includes(ReasonCodes.PER_PAYMENT_LIMIT_EXCEEDED));
});

// ───────── Idempotency & rebuild ─────────

test('apply is idempotent: re-applying events changes nothing', async () => {
  const f = await buildFixture('success');
  const p = new LedgerProjection();
  for (const e of f.events) assert.equal(p.apply(e).status, 'applied');
  const before = JSON.stringify(p.snapshot(NOW));
  for (const e of f.events) assert.equal(p.apply(e).status, 'duplicate_skipped');
  assert.equal(JSON.stringify(p.snapshot(NOW)), before);
  assert.equal(p.appliedEventCount, f.events.length);
});

test('consumer catches up incrementally and is idempotent across repeated runs', async () => {
  const f = await buildFixture('success');
  const store = new InMemoryEventStore();
  const consumer = new LedgerConsumer(store, new LedgerProjection(), 3);
  assert.deepEqual(await consumer.catchUp(), { applied: 0, duplicatesSkipped: 0, quarantined: 0, lastSequence: 0 });
  const half = f.events.length >> 1;
  for (const e of f.events.slice(0, half)) await store.append(strip(e));
  assert.equal((await consumer.catchUp()).applied, half);
  for (const e of f.events.slice(half)) await store.append(strip(e));
  const r = await consumer.catchUp();
  assert.equal(r.applied, f.events.length - half);
  assert.equal((await consumer.catchUp()).applied, 0);
  // re-appending identical events is a store-level no-op, so the consumer sees nothing new
  for (const e of f.events) assert.equal((await store.append(strip(e))).duplicate, true);
  assert.equal((await consumer.catchUp()).applied, 0);
  assert.deepEqual(consumer.projection.snapshot(NOW), rebuildLedger(f.events).snapshot(NOW));
});

test('a second consumer replaying from sequence 0 reaches the same state (projection rebuild)', async () => {
  const f = await buildFixture('over_limit');
  const { store } = await replay(f.events);
  const live = new LedgerConsumer(store);
  await live.catchUp();
  const fresh = new LedgerConsumer(store);
  await fresh.catchUp();
  assert.deepEqual(fresh.projection.snapshot(NOW), live.projection.snapshot(NOW));
  assert.deepEqual(rebuildLedger(await store.readFrom(0)).snapshot(NOW), live.projection.snapshot(NOW));
});

test('out-of-order delivery of an unseen event is rejected loudly', async () => {
  const f = await buildFixture('success');
  const p = new LedgerProjection();
  p.apply(f.events[5] as AuditEvent);
  assert.throws(() => p.apply(f.events[2] as AuditEvent), (e: unknown) => e instanceof LedgerError && e.code === 'SEQUENCE_REGRESSION');
});

// ───────── Duplicate settlement protection ─────────

type SettleInput = Extract<AuditEventInput, { type: 'SettlementConfirmed' }>;

async function successStore(): Promise<{ store: InMemoryEventStore; settlement: SettleInput; all: AuditEvent[] }> {
  const f = await buildFixture('success');
  const { store, events } = await replay(f.events);
  const settlement = strip(events.find((e) => e.type === 'SettlementConfirmed') as AuditEvent) as SettleInput;
  return { store, settlement, all: events };
}
const reproject = async (store: InMemoryEventStore) => rebuildLedger(await store.readFrom(0));

function assertBooksUnchanged(p: LedgerProjection): void {
  assert.equal(p.settlements().length, 1);
  assert.equal(p.vendorExpense()[0]?.settledMinor, usdc('1000'));
  assert.equal(p.agentSpend()[0]?.settledMinor, usdc('1000'));
  assert.equal(p.taskEconomics()[0]?.costMinor, usdc('1000'));
  assert.equal(p.ledgerEntries().length, 1);
  assert.equal(p.mandateAllowance(I.mandateId)?.remainingMinor, usdc('11000'));
}

test('duplicate settlement: same settlementId under a new eventId is quarantined', async () => {
  const { store, settlement } = await successStore();
  await store.append({ ...settlement, eventId: 'dup_1' });
  const p = await reproject(store);
  assert.deepEqual(p.anomalies().map((a) => a.code), [ReasonCodes.DUPLICATE_SETTLEMENT_ID]);
  assertBooksUnchanged(p);
});

test('duplicate settlement: same on-chain signature under a different settlementId is quarantined', async () => {
  const { store, settlement } = await successStore();
  await store.append({ ...settlement, eventId: 'dup_2', payload: { ...settlement.payload, settlementId: 'stl_other' } });
  const p = await reproject(store);
  const [a] = p.anomalies();
  assert.equal(a?.code, ReasonCodes.DUPLICATE_SETTLEMENT_SIGNATURE);
  assert.equal(a?.params['originalSettlementId'], 'stl_int_0001');
  assertBooksUnchanged(p);
});

test('duplicate settlement: a second settlement for an already-settled intent is quarantined', async () => {
  const { store, settlement } = await successStore();
  await store.append({ ...settlement, eventId: 'dup_3', payload: { ...settlement.payload, settlementId: 'stl_other', signature: syntheticSignature('another') } });
  const p = await reproject(store);
  assert.deepEqual(p.anomalies().map((a) => a.code), [ReasonCodes.DUPLICATE_SETTLEMENT_INTENT]);
  assertBooksUnchanged(p);
});

test('same signature on a different cluster is NOT a duplicate key, but still cannot double-settle the intent', async () => {
  const { store, settlement } = await successStore();
  await store.append({ ...settlement, eventId: 'dup_4', payload: { ...settlement.payload, settlementId: 'stl_local', cluster: 'localnet' } });
  const p = await reproject(store);
  assert.deepEqual(p.anomalies().map((a) => a.code), [ReasonCodes.DUPLICATE_SETTLEMENT_INTENT]);
  assertBooksUnchanged(p);
});

test('settlement for a rejected intent is quarantined', async () => {
  const f = await buildFixture('over_limit');
  const { store } = await replay(f.events);
  await store.append({
    eventId: 'rogue_1', type: 'SettlementConfirmed', occurredAt: '2026-11-07T11:05:00Z', schemaVersion: 1,
    payload: { settlementId: 'stl_rogue', intentId: 'int_0002', signature: syntheticSignature('rogue'), cluster: 'devnet', vendorId: I.vendorId, currency: 'USDC', amountMinor: usdc('3500'), slot: 1, confirmedAt: '2026-11-07T11:05:00Z' },
  });
  const p = await reproject(store);
  assert.equal(p.anomalies()[0]?.code, ReasonCodes.SETTLEMENT_WITHOUT_APPROVED_DECISION);
  assert.equal(p.settlements().length, 1);
  assert.equal(p.mandateAllowance(I.mandateId)?.remainingMinor, usdc('11000'));
});

test('settlement that disagrees with the approved intent (amount / vendor / signature) is quarantined', async () => {
  const f = await buildFixture('success');
  const pending = (await replay(f.events, { keep: (e) => e.type !== 'SettlementConfirmed' && e.type !== 'TaskRevenueRecorded' })).events;
  const base = strip(f.events.find((e) => e.type === 'SettlementConfirmed') as AuditEvent) as SettleInput;

  const run = async (override: Partial<SettleInput['payload']>, expected: string): Promise<void> => {
    const { store } = await replay(pending);
    await store.append({ ...base, eventId: 'bad_settle', payload: { ...base.payload, ...override } });
    const p = await reproject(store);
    assert.equal(p.anomalies()[0]?.code, expected);
    assert.equal(p.settlements().length, 0);
    assert.equal(p.mandateAllowance(I.mandateId)?.pendingMinor, usdc('1000'), 'reservation still pending');
  };
  await run({ amountMinor: usdc('999') }, ReasonCodes.SETTLEMENT_AMOUNT_MISMATCH);
  await run({ vendorId: I.otherVendorId }, ReasonCodes.SETTLEMENT_VENDOR_MISMATCH);
  await run({ signature: syntheticSignature('different') }, ReasonCodes.SETTLEMENT_SIGNATURE_MISMATCH);
});

test('approved-but-unsettled intents reserve allowance; failure releases it', async () => {
  const f = await buildFixture('success');
  const { store } = await replay(f.events, { keep: (e) => e.type !== 'SettlementConfirmed' && e.type !== 'TaskRevenueRecorded' });
  let p = await reproject(store);
  assert.equal(p.mandateAllowance(I.mandateId)?.pendingMinor, usdc('1000'));
  assert.equal(p.mandateAllowance(I.mandateId)?.remainingMinor, usdc('11000'));
  assert.equal(p.agentSpend()[0]?.pendingMinor, usdc('1000'));
  assert.equal(p.contractObligations()[0]?.pendingMinor, usdc('1000'));
  // a second 1,000 payment now sees only 3,000 of the 4,000 period cap left
  assert.equal(p.mandateAllowance(I.mandateId, NOW)?.periodRemainingMinor, usdc('3000'));

  await store.append({ eventId: 'fail_1', type: 'SettlementFailed', occurredAt: '2026-11-07T10:01:00Z', schemaVersion: 1, payload: { intentId: 'int_0001', reasonText: 'blockhash expired', failedAt: '2026-11-07T10:01:00Z' } });
  p = await reproject(store);
  assert.equal(p.mandateAllowance(I.mandateId)?.pendingMinor, '0');
  assert.equal(p.mandateAllowance(I.mandateId)?.remainingMinor, usdc('12000'));
  assert.equal(p.intentViews()[0]?.status, 'failed');
});

// ───────── Other integrity rules ─────────

test('AI/non-human approvers cannot create obligations, mandates or delegations', async () => {
  const f = await buildFixture('success');
  const { events } = await replay(f.events, {
    map: (e) => {
      if (e.type === 'MandateCreated') return { ...e, payload: { ...e.payload, approvedBy: 'agent:rogue_planner' } };
      return e;
    },
  });
  const p = rebuildLedger(events);
  const codes = p.anomalies().map((a) => a.code);
  assert.ok(codes.includes(ReasonCodes.NON_HUMAN_APPROVER));
  assert.equal(p.mandateAllowances().length, 0);
  assert.equal(p.settlements().length, 0, 'settlement cannot book without a valid mandate');
  assert.equal(p.vendorExpense().length, 0);
});

test('obligation approved by a non-human is ignored', async () => {
  const f = await buildFixture('success');
  const { events } = await replay(f.events, { map: (e) => (e.type === 'ObligationApproved' ? { ...e, payload: { ...e.payload, approvedBy: 'ai:extractor' } } : e) });
  const p = rebuildLedger(events);
  assert.equal(p.contractObligations().length, 0);
  assert.ok(p.anomalies().some((a) => a.code === ReasonCodes.NON_HUMAN_APPROVER));
  assert.ok(p.anomalies().some((a) => a.code === ReasonCodes.UNKNOWN_REFERENCE), 'mandate then has no obligation');
});

test('mandate larger than its obligation, or for another vendor, is refused', async () => {
  const f = await buildFixture('success');
  const big = rebuildLedger((await replay(f.events, { map: (e) => (e.type === 'MandateCreated' ? { ...e, payload: { ...e.payload, limitMinor: usdc('12001') } } : e) })).events);
  assert.ok(big.anomalies().some((a) => a.code === ReasonCodes.MANDATE_EXCEEDS_OBLIGATION));
  const other = rebuildLedger((await replay(f.events, { map: (e) => (e.type === 'MandateCreated' ? { ...e, payload: { ...e.payload, vendorId: 'vendor_x' } } : e) })).events);
  assert.ok(other.anomalies().some((a) => a.code === ReasonCodes.MANDATE_OBLIGATION_VENDOR_MISMATCH));
});

test('invalid payloads and unsupported currencies are quarantined, never thrown', async () => {
  const f = await buildFixture('success');
  const { events } = await replay(f.events, {
    map: (e) => {
      if (e.type === 'TaskRevenueRecorded') return { ...e, payload: { ...e.payload, amountMinor: '18.50' } };
      if (e.type === 'SpendIntentSubmitted') return { ...e, payload: { ...e.payload, currency: 'EUR' } };
      return e;
    },
  });
  const p = rebuildLedger(events);
  const codes = p.anomalies().map((a) => a.code);
  assert.ok(codes.includes(ReasonCodes.INVALID_PAYLOAD));
  assert.ok(codes.includes(ReasonCodes.UNSUPPORTED_CURRENCY));
  assert.equal(p.taskEconomics().length, 0);
});

test('duplicate revenue id and conflicting second decision are quarantined', async () => {
  const { store, all } = await successStore();
  const rev = strip(all.find((e) => e.type === 'TaskRevenueRecorded') as AuditEvent);
  await store.append({ ...rev, eventId: 'rev_dup' });
  const dec = strip(all.find((e) => e.type === 'PolicyDecisionRecorded') as AuditEvent) as Extract<AuditEventInput, { type: 'PolicyDecisionRecorded' }>;
  await store.append({ ...dec, eventId: 'dec_dup', payload: { ...dec.payload, decisionId: 'dec_2', decision: 'rejected', reasonCodes: [ReasonCodes.MANDATE_REVOKED] } });
  const p = await reproject(store);
  assert.deepEqual(p.anomalies().map((a) => a.code), [ReasonCodes.DUPLICATE_ENTITY, ReasonCodes.DECISION_CONFLICT]);
  assert.equal(p.taskEconomics()[0]?.revenueMinor, usdc('1800'));
  assert.equal(p.intentViews()[0]?.status, 'settled');
});

test('task margin: negative margin and zero revenue', async () => {
  const f = await buildFixture('success');
  const { events } = await replay(f.events, { map: (e) => (e.type === 'TaskRevenueRecorded' ? { ...e, payload: { ...e.payload, amountMinor: usdc('400') } } : e) });
  assert.deepEqual(rebuildLedger(events).taskEconomics()[0], { taskId: I.taskId, costMinor: usdc('1000'), revenueMinor: usdc('400'), marginMinor: `-${usdc('600')}`, marginBps: -15000, settlementCount: 1 });
  const none = rebuildLedger(f.events.filter((e) => e.type !== 'TaskRevenueRecorded')).taskEconomics()[0];
  assert.equal(none?.marginBps, null);
  assert.equal(none?.marginMinor, `-${usdc('1000')}`);
});

test('snapshot is JSON-serialisable (no bigint leaks)', async () => {
  const f = await buildFixture('over_limit');
  assert.doesNotThrow(() => JSON.stringify(rebuildLedger(f.events).snapshot(NOW)));
});
