/**
 * Append-only audit log interfaces + in-memory test store.
 * The interface deliberately has no update/delete. Persistence adapters (DB, object store) are
 * out of scope; implement `EventStore` against whatever the integrator chooses.
 */
import { canonicalJson, deepFreezeCopy } from './canonical.js';
import { type AuditEvent, type AuditEventInput, EVENT_SCHEMA_VERSION, GENESIS_HASH } from './events.js';
import { findSecretFields } from './redaction.js';
import { sha256Hex } from './sha256.js';

export class EventStoreError extends Error {
  constructor(public readonly code: 'INVALID_EVENT' | 'EVENT_CONFLICT' | 'SECRET_FIELD', message: string) {
    super(message);
    this.name = 'EventStoreError';
  }
}

export interface AppendResult {
  readonly event: AuditEvent;
  /** true when the same eventId with identical content was already stored (idempotent no-op). */
  readonly duplicate: boolean;
}

export interface EventReader {
  /** Events with sequence > afterSequence, ascending. */
  readFrom(afterSequence: number, limit?: number): Promise<readonly AuditEvent[]>;
}

export interface EventStore extends EventReader {
  append(input: AuditEventInput): Promise<AppendResult>;
  head(): Promise<{ sequence: number; hash: string }>;
}

const EVENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function computeEventHash(e: Pick<AuditEvent, 'sequence' | 'prevHash' | 'eventId' | 'type' | 'occurredAt' | 'schemaVersion' | 'payload'> & { source?: string | undefined }): string {
  return sha256Hex(canonicalJson({
    schemaVersion: e.schemaVersion, eventId: e.eventId, type: e.type, occurredAt: e.occurredAt,
    source: e.source ?? null, payload: e.payload, sequence: e.sequence, prevHash: e.prevHash,
  }));
}

function contentKey(input: AuditEventInput): string {
  return canonicalJson({
    schemaVersion: input.schemaVersion, eventId: input.eventId, type: input.type,
    occurredAt: input.occurredAt, source: input.source ?? null, payload: input.payload,
  });
}

export function validateEventInput(input: AuditEventInput): void {
  const bad = (m: string): never => { throw new EventStoreError('INVALID_EVENT', m); };
  if (typeof input !== 'object' || input === null) bad('Event must be an object');
  if (!EVENT_ID.test(input.eventId)) bad('eventId must be 1-128 chars of [A-Za-z0-9._:-]');
  if (typeof input.type !== 'string' || input.type.length === 0) bad('type is required');
  if (input.schemaVersion !== EVENT_SCHEMA_VERSION) bad(`schemaVersion must be ${EVENT_SCHEMA_VERSION}`);
  if (typeof input.occurredAt !== 'string' || Number.isNaN(Date.parse(input.occurredAt))) bad('occurredAt must be an ISO-8601 timestamp');
  if (typeof input.payload !== 'object' || input.payload === null || Array.isArray(input.payload)) bad('payload must be an object');
  const secrets = findSecretFields(input.payload);
  if (secrets.length > 0) {
    throw new EventStoreError('SECRET_FIELD', `Payload has secret-looking fields (${secrets.join(', ')}). Keys, seeds and API secrets must never enter the audit log.`);
  }
  try { canonicalJson(input.payload); } catch (err) { bad(`payload is not JSON-serialisable: ${(err as Error).message}`); }
}

export class InMemoryEventStore implements EventStore {
  private readonly events: AuditEvent[] = [];
  private readonly byId = new Map<string, { event: AuditEvent; key: string }>();

  async append(input: AuditEventInput): Promise<AppendResult> {
    validateEventInput(input);
    const key = contentKey(input);
    const existing = this.byId.get(input.eventId);
    if (existing) {
      if (existing.key === key) return { event: existing.event, duplicate: true };
      throw new EventStoreError('EVENT_CONFLICT', `eventId ${input.eventId} already exists with different content`);
    }
    const prev = this.events[this.events.length - 1];
    const base = {
      ...(JSON.parse(canonicalJson(input)) as AuditEventInput),
      sequence: (prev?.sequence ?? 0) + 1,
      prevHash: prev?.hash ?? GENESIS_HASH,
    };
    const event = deepFreezeCopy({ ...base, hash: computeEventHash(base) }) as AuditEvent;
    this.events.push(event);
    this.byId.set(event.eventId, { event, key });
    return { event, duplicate: false };
  }

  async readFrom(afterSequence: number, limit = Number.MAX_SAFE_INTEGER): Promise<readonly AuditEvent[]> {
    return this.events.filter((e) => e.sequence > afterSequence).slice(0, limit);
  }

  async head(): Promise<{ sequence: number; hash: string }> {
    const last = this.events[this.events.length - 1];
    return { sequence: last?.sequence ?? 0, hash: last?.hash ?? GENESIS_HASH };
  }
}

export interface ChainVerification {
  readonly ok: boolean;
  readonly checkedEvents: number;
  readonly brokenAtSequence?: number;
  readonly reason?: string;
}

/** Recomputes every hash and link. If the first event is sequence 1 its prevHash must be genesis. */
export function verifyEventChain(events: readonly AuditEvent[]): ChainVerification {
  let prev: AuditEvent | undefined;
  let checked = 0;
  for (const e of events) {
    const fail = (reason: string): ChainVerification => ({ ok: false, checkedEvents: checked, brokenAtSequence: e.sequence, reason });
    if (prev === undefined) {
      if (e.sequence === 1 && e.prevHash !== GENESIS_HASH) return fail('First event must link to the genesis hash');
    } else {
      if (e.sequence !== prev.sequence + 1) return fail('Sequence is not contiguous');
      if (e.prevHash !== prev.hash) return fail('prevHash does not match the previous event hash');
    }
    if (computeEventHash(e) !== e.hash) return fail('Event content does not match its hash (tampered?)');
    prev = e;
    checked++;
  }
  return { ok: true, checkedEvents: checked };
}
