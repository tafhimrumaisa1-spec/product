import { AuditEventSchema, type AuditEvent } from "./entities";
import { digest } from "./commitments";
import { FluxGraphError } from "./errors";
import type { DomainEvent } from "./events";
import { deriveId } from "./ids";
import { err, ok, type Result } from "./result";

/**
 * Per-company, append-only hash chain over domain events. FluxProof renders it; FluxGraph defines it.
 * hash = digest("audit", {companyId, sequence, domainEventId, eventType, actor, subject, occurredAt, prevHash})
 * Editing, removing or reordering any event breaks every later hash.
 */
function hashOf(a: Omit<AuditEvent, "id" | "hash">): AuditEvent["hash"] {
  return digest("audit-event", {
    companyId: a.companyId, sequence: a.sequence, domainEventId: a.domainEventId, eventType: a.eventType,
    actor: a.actor, subject: a.subject, occurredAt: a.occurredAt, prevHash: a.prevHash,
  });
}

export function buildAuditEvent(prev: AuditEvent | null, event: DomainEvent): AuditEvent {
  if (prev && prev.companyId !== event.companyId) throw new FluxGraphError("AUDIT_CHAIN_BROKEN", "Audit chains are per company; company mismatch");
  if (prev && event.occurredAt < prev.occurredAt) throw new FluxGraphError("AUDIT_CHAIN_BROKEN", "Events must be appended in non-decreasing time order");
  const sequence = prev ? prev.sequence + 1 : 1;
  const core = {
    companyId: event.companyId, sequence, domainEventId: event.eventId, eventType: event.type,
    actor: event.actor, subject: { type: event.subject.type, id: event.subject.id },
    occurredAt: event.occurredAt, prevHash: prev ? prev.hash : null,
  };
  return AuditEventSchema.parse({ ...core, id: deriveId("auditEvent", event.companyId, sequence), hash: hashOf(core) });
}

/** Build the chain for one company's events (already in order). */
export function buildAuditChain(events: readonly DomainEvent[]): AuditEvent[] {
  const chain: AuditEvent[] = [];
  for (const e of events) chain.push(buildAuditEvent(chain.at(-1) ?? null, e));
  return chain;
}

export function verifyAuditChain(chain: readonly AuditEvent[]): Result<true> {
  const broken = (i: number, why: string) => err(new FluxGraphError("AUDIT_CHAIN_BROKEN", `Audit chain broken at index ${i}: ${why}`));
  let prev: AuditEvent | null = null;
  for (let i = 0; i < chain.length; i++) {
    const a = chain[i]!;
    const parsed = AuditEventSchema.safeParse(a);
    if (!parsed.success) return broken(i, "schema violation");
    if (prev && a.companyId !== prev.companyId) return broken(i, "company changed mid-chain");
    if (a.sequence !== (prev ? prev.sequence + 1 : 1)) return broken(i, `sequence ${a.sequence} is not gapless`);
    if (a.prevHash !== (prev ? prev.hash : null)) return broken(i, "prevHash does not match previous hash");
    if (prev && a.occurredAt < prev.occurredAt) return broken(i, "time went backwards");
    if (a.hash !== hashOf(a)) return broken(i, "hash does not match content");
    prev = a;
  }
  return ok(true);
}
