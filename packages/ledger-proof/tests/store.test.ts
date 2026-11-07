import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type AuditEvent, type AuditEventInput, EventStoreError, GENESIS_HASH, InMemoryEventStore, buildFixture, verifyEventChain } from '../source/index.js';

const input = (id: string, extra: Record<string, unknown> = {}): AuditEventInput => ({
  eventId: id, type: 'MandateRevoked', occurredAt: '2026-11-07T10:00:00Z', schemaVersion: 1,
  payload: { mandateId: 'm1', revokedBy: 'human:a', reasonText: 'x', ...extra },
});

test('append assigns contiguous sequence and a hash chain from genesis', async () => {
  const s = new InMemoryEventStore();
  const a = await s.append(input('e1'));
  const b = await s.append(input('e2'));
  assert.equal(a.event.sequence, 1); assert.equal(b.event.sequence, 2);
  assert.equal(a.event.prevHash, GENESIS_HASH); assert.equal(b.event.prevHash, a.event.hash);
  assert.deepEqual(await s.head(), { sequence: 2, hash: b.event.hash });
  assert.deepEqual(verifyEventChain(await s.readFrom(0)), { ok: true, checkedEvents: 2 });
});

test('same eventId + identical content is an idempotent no-op; different content conflicts', async () => {
  const s = new InMemoryEventStore();
  const first = await s.append(input('e1'));
  const again = await s.append(input('e1'));
  assert.equal(again.duplicate, true);
  assert.equal(again.event.hash, first.event.hash);
  assert.equal((await s.readFrom(0)).length, 1);
  await assert.rejects(() => s.append(input('e1', { reasonText: 'changed' })), (e: unknown) => e instanceof EventStoreError && e.code === 'EVENT_CONFLICT');
});

test('key order in payload does not create a conflict', async () => {
  const s = new InMemoryEventStore();
  await s.append(input('e1'));
  const reordered: AuditEventInput = { eventId: 'e1', type: 'MandateRevoked', occurredAt: '2026-11-07T10:00:00Z', schemaVersion: 1, payload: { reasonText: 'x', revokedBy: 'human:a', mandateId: 'm1' } };
  assert.equal((await s.append(reordered)).duplicate, true);
});

test('validation: bad id, bad time, secret-looking fields', async () => {
  const s = new InMemoryEventStore();
  await assert.rejects(() => s.append(input('bad id!')), (e: unknown) => e instanceof EventStoreError && e.code === 'INVALID_EVENT');
  await assert.rejects(() => s.append({ ...input('e2'), occurredAt: 'yesterday' }), EventStoreError);
  await assert.rejects(() => s.append(input('e3', { privateKey: 'x' })), (e: unknown) => e instanceof EventStoreError && e.code === 'SECRET_FIELD');
  await assert.rejects(() => s.append(input('e4', { nested: { apiKey: 'x' } })), (e: unknown) => e instanceof EventStoreError && e.code === 'SECRET_FIELD');
  assert.equal((await s.readFrom(0)).length, 0);
});

test('stored events are frozen (append-only, no mutation)', async () => {
  const s = new InMemoryEventStore();
  const { event } = await s.append(input('e1'));
  assert.throws(() => { (event.payload as { mandateId: string }).mandateId = 'hacked'; }, TypeError);
  assert.equal(Object.isFrozen(event), true);
});

test('readFrom respects cursor and limit', async () => {
  const s = new InMemoryEventStore();
  for (const id of ['e1', 'e2', 'e3', 'e4']) await s.append(input(id));
  assert.deepEqual((await s.readFrom(1, 2)).map((e) => e.sequence), [2, 3]);
  assert.deepEqual((await s.readFrom(4)).length, 0);
});

test('verifyEventChain detects tampering, reordering and gaps', async () => {
  const f = await buildFixture('success');
  assert.equal(verifyEventChain(f.events).ok, true);

  const tampered: AuditEvent[] = f.events.map((e, i) => (i === 8 ? ({ ...e, payload: { ...e.payload, limitMinor: '99' } } as AuditEvent) : e));
  const t = verifyEventChain(tampered);
  assert.equal(t.ok, false); assert.equal(t.brokenAtSequence, 9);

  const gap = verifyEventChain(f.events.filter((e) => e.sequence !== 4));
  assert.equal(gap.ok, false);

  const swapped = [...f.events]; [swapped[2], swapped[3]] = [swapped[3] as AuditEvent, swapped[2] as AuditEvent];
  assert.equal(verifyEventChain(swapped).ok, false);
});
