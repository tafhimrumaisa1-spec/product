import { type AuditEvent, type AuditEventInput, InMemoryEventStore } from '../source/index.js';

/** Removes store-assigned fields so an event can be re-appended to a fresh store. */
export function strip(e: AuditEvent): AuditEventInput {
  const { sequence: _s, prevHash: _p, hash: _h, ...input } = e;
  return input as AuditEventInput;
}

/** Replays events (optionally filtered/transformed) into a fresh in-memory store. */
export async function replay(
  events: readonly AuditEvent[],
  opts: { keep?: (e: AuditEvent) => boolean; map?: (e: AuditEventInput) => AuditEventInput } = {},
): Promise<{ store: InMemoryEventStore; events: AuditEvent[] }> {
  const store = new InMemoryEventStore();
  for (const e of events) {
    if (opts.keep && !opts.keep(e)) continue;
    const input = strip(e);
    await store.append(opts.map ? opts.map(input) : input);
  }
  return { store, events: [...(await store.readFrom(0))] };
}

export const NOW = '2026-11-07T13:00:00Z';
