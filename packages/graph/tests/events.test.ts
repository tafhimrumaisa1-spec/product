import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createEvent, DomainEventSchema, deserializeEvent, EVENT_TYPES, eventsFromJsonl, eventsToJsonl, FIXTURE, FluxGraphError, isEventType,
  LIFECYCLE_SUBJECT_KINDS, parseEvent, serializeEvent, deriveId, commit, humanActor, parseId, canonicalize,
  type DomainEvent,
} from "../src/index";
import { agent, agentId, ai, clone, human, maya, system } from "./helpers";

const ids = FIXTURE.ids;
const company = parseId("company", ids["company"]);
const AT = "2026-10-06T00:00:00Z";
const common = { companyId: company, occurredAt: AT, correlationId: "test-flow-0001" };
const obl = parseId("obligation", ids["paymentObligation"]);
const ctr = parseId("contract", ids["contract"]);
const mnd = parseId("mandate", ids["mandate"]);
const spi = parseId("spendIntent", ids["spendIntentAuthorized"]);
const pol = parseId("policyDecision", ids["decisionAllow"]);
const usdc = { amountMinor: "100", currency: "USDC" };
const throwsSchema = (fn: () => unknown) => assert.throws(fn, (e: unknown) => e instanceof FluxGraphError && e.code === "SCHEMA_VIOLATION");

test("schema defines exactly the declared event types", () => {
  const options = (DomainEventSchema as unknown as { _def: { schema: { options: { shape: { type: { value: string } } }[] } } })._def.schema.options.map((o) => o.shape.type.value);
  assert.deepEqual([...options].sort(), [...EVENT_TYPES].sort());
  for (const t of ["ContractUploaded", "TermsExtracted", "ObligationApproved", "ScenarioCalculated", "MandateProposed", "MandateActivated", "SpendRequested", "SpendApproved", "SpendBlocked", "SettlementConfirmed", "LedgerEntryPosted", "TwinUpdated"]) {
    assert.ok(isEventType(t), `${t} required by brief`);
  }
  assert.ok(!isEventType("Nope"));
});

test("fixture events are valid, ordered, causally chained and content-addressed", () => {
  assert.ok(FIXTURE.events.length >= 30);
  FIXTURE.events.forEach((e, i) => {
    assert.ok(DomainEventSchema.safeParse(e).success, `event ${i}`);
    assert.equal(e.causationId, i === 0 ? null : FIXTURE.events[i - 1]!.eventId);
    if (i > 0) assert.ok(e.occurredAt >= FIXTURE.events[i - 1]!.occurredAt);
  });
  assert.equal(new Set(FIXTURE.events.map((e) => e.eventId)).size, FIXTURE.events.length, "unique ids");
  const used = new Set(FIXTURE.events.map((e) => e.type));
  for (const t of ["ContractUploaded", "TermsExtracted", "ObligationApproved", "ScenarioCalculated", "MandateProposed", "MandateActivated", "SpendRequested", "SpendApproved", "SpendBlocked", "SettlementConfirmed", "LedgerEntryPosted", "TwinUpdated", "LifecycleTransitioned"] as const) assert.ok(used.has(t), `golden demo uses ${t}`);
});

test("createEvent is deterministic and idempotent", () => {
  const body = { ...common, actor: human, subject: { type: "obligation" as const, id: obl }, payload: { contractId: ctr, approvedBy: maya } };
  const a = createEvent("ObligationApproved", body);
  const b = createEvent("ObligationApproved", clone(body));
  assert.equal(a.eventId, b.eventId);
  assert.notEqual(a.eventId, createEvent("ObligationApproved", { ...body, occurredAt: "2026-10-06T00:00:01Z" }).eventId);
  assert.notEqual(a.eventId, createEvent("ObligationApproved", { ...body, causationId: a.eventId }).eventId);
  assert.equal(a.schemaVersion, 1);
});

test("actor rules: approvals are human-only and self-consistent", () => {
  const base = { ...common, subject: { type: "obligation" as const, id: obl }, payload: { contractId: ctr, approvedBy: maya } };
  for (const a of [ai, agent, system]) throwsSchema(() => createEvent("ObligationApproved", { ...base, actor: a }));
  const other = parseId("user", deriveId("user", "someone-else"));
  throwsSchema(() => createEvent("ObligationApproved", { ...base, actor: humanActor(other) }));
  throwsSchema(() => createEvent("ObligationRejected", { ...common, actor: ai, subject: base.subject, payload: { contractId: ctr, rejectedBy: maya, reason: "x" } }));
  throwsSchema(() => createEvent("MandateApproved", { ...common, actor: system, subject: { type: "mandate", id: mnd }, payload: { approvedBy: maya } }));
  throwsSchema(() => createEvent("MandateApproved", { ...common, actor: ai, subject: { type: "mandate", id: mnd }, payload: { approvedBy: maya } }));
  throwsSchema(() => createEvent("MandateRevoked", { ...common, actor: agent, subject: { type: "mandate", id: mnd }, payload: { revokedBy: maya, reason: "x" } }));
  throwsSchema(() => createEvent("ContractActivated", { ...common, actor: ai, subject: { type: "contract", id: ctr }, payload: { contractVersionId: parseId("contractVersion", ids["contractVersion"]), approvedObligationIds: [obl] } }));
  assert.ok(createEvent("MandateApproved", { ...common, actor: human, subject: { type: "mandate", id: mnd }, payload: { approvedBy: maya } }));
});

test("actor rules: agents may only request spends; AI may only interpret/propose", () => {
  const mk = (a: typeof agent) => createEvent("SpendRequested", { ...common, actor: a, subject: { type: "spendIntent", id: spi }, payload: { mandateId: mnd, agentId, counterpartyId: parseId("counterparty", ids["vendor"]), taskId: parseId("task", ids["taskAuthorized"]), amount: usdc } });
  assert.ok(mk(agent));
  for (const a of [ai, system, human]) throwsSchema(() => mk(a));
  throwsSchema(() => mk({ type: "agent", id: parseId("agent", deriveId("agent", "other")) }));
  const approved = (a: typeof agent, decidedBy: "policy_engine" | "human") => createEvent("SpendApproved", { ...common, actor: a, subject: { type: "spendIntent", id: spi }, payload: { policyDecisionId: pol, mandateId: mnd, amount: usdc, decidedBy } });
  assert.ok(approved(system, "policy_engine"));
  assert.ok(approved(human, "human"));
  for (const [a, d] of [[agent, "policy_engine"], [ai, "policy_engine"], [agent, "human"], [ai, "human"], [system, "human"], [human, "policy_engine"]] as const) throwsSchema(() => approved(a, d));
  throwsSchema(() => createEvent("SpendBlocked", { ...common, actor: agent, subject: { type: "spendIntent", id: spi }, payload: { policyDecisionId: pol, mandateId: mnd, amount: usdc, reasonCodes: ["EXCEEDS_PERIOD_LIMIT"], decidedBy: "policy_engine" } }));
  throwsSchema(() => createEvent("SpendBlocked", { ...common, actor: system, subject: { type: "spendIntent", id: spi }, payload: { policyDecisionId: pol, mandateId: mnd, amount: usdc, reasonCodes: [], decidedBy: "policy_engine" } }));
  throwsSchema(() => createEvent("SettlementConfirmed", { ...common, actor: ai, subject: { type: "settlement", id: parseId("settlement", ids["settlement"]) }, payload: { transactionId: parseId("transaction", ids["transaction"]), spendIntentId: spi, signature: "1".repeat(88), slot: 1, amount: usdc } }));
  throwsSchema(() => createEvent("TwinUpdated", { ...common, actor: ai, subject: { type: "company", id: company }, payload: { forecastId: parseId("forecast", deriveId("forecast", "f")), scenarioId: parseId("scenario", ids["scenarioBaseline"]), cause: "scenario_changed", runwayMonths: null } }));
});

test("structural rules: subject kind, strict payloads, bad ids, lifecycle prefix match", () => {
  const good = FIXTURE.events[0]!;
  const bad = (patch: object) => assert.ok(!DomainEventSchema.safeParse({ ...clone(good), ...patch }).success);
  bad({ subject: { type: "mandate", id: good.subject.id } });
  bad({ extra: 1 });
  bad({ schemaVersion: 2 });
  bad({ companyId: "cmp_zz" });
  bad({ occurredAt: "yesterday" });
  bad({ payload: { ...(good.payload as object), leaked: "x" } });
  bad({ type: "NotAnEvent" });
  const lc = FIXTURE.events.find((e) => e.type === "LifecycleTransitioned")!;
  assert.ok(!DomainEventSchema.safeParse({ ...clone(lc), subject: { type: "mandate", id: lc.subject.id } }).success, "prefix must match type");
  assert.deepEqual(LIFECYCLE_SUBJECT_KINDS.length, 5);
});

test("SECURITY: no event leaks contract text, citations excerpts or secret-looking fields", () => {
  const blob = eventsToJsonl(FIXTURE.events);
  for (const c of FIXTURE.graph.citations) assert.ok(!blob.includes(c.excerpt.slice(0, 30)), "excerpt text must never appear in events");
  assert.ok(!/excerpt|privateKey|secret|seed|mnemonic|apiKey|vault:\/\//i.test(blob));
  for (const e of FIXTURE.events) assert.ok(!("excerpt" in (e.payload as object)));
});

test("serialization: canonical, round-trips, rejects tampering", () => {
  for (const e of FIXTURE.events) {
    const json = serializeEvent(e);
    assert.equal(json, canonicalize(e));
    const back = deserializeEvent(json);
    assert.ok(back.ok);
    if (back.ok) assert.deepEqual(back.value, e);
  }
  const jsonl = eventsToJsonl(FIXTURE.events);
  assert.equal(jsonl.split("\n").length, FIXTURE.events.length + 1);
  const parsed = eventsFromJsonl(jsonl);
  assert.ok(parsed.ok && parsed.value.length === FIXTURE.events.length);
  assert.equal(eventsToJsonl([]), "");
  const broken = eventsFromJsonl(jsonl + "{not json}\n");
  assert.ok(!broken.ok && broken.error.code === "INVALID_JSON" && /Line \d+/.test(broken.error.message));
  const invalid = deserializeEvent(JSON.stringify({ ...FIXTURE.events[0], companyId: "x" }));
  assert.ok(!invalid.ok && invalid.error.code === "SCHEMA_VIOLATION" && invalid.error.details.length > 0);
  assert.ok(!deserializeEvent("").ok);
  assert.throws(() => serializeEvent({ ...(FIXTURE.events[0] as DomainEvent), companyId: "bad" } as never), /Refusing/);
  assert.ok(!parseEvent(null).ok && !parseEvent({}).ok);
  assert.ok(commit("x", "a1b2c3d4e5f60718293a4b5c6d7e8f90").startsWith("sha256:"));
});

test("all declared event types can be constructed (coverage of the less-used events)", () => {
  const sig = "2".repeat(88);
  const f = parseId("forecast", deriveId("forecast", "f"));
  const stl = parseId("settlement", ids["settlement"]);
  const tx = parseId("transaction", ids["transaction"]);
  const ver = parseId("contractVersion", ids["contractVersion"]);
  const built: unknown[] = [
    createEvent("ExtractionFailed", { ...common, actor: ai, subject: { type: "contract", id: ctr }, payload: { contractVersionId: ver, reason: "unreadable scan" } }),
    createEvent("ObligationRejected", { ...common, actor: human, subject: { type: "obligation", id: obl }, payload: { contractId: ctr, rejectedBy: maya, reason: "wrong amount" } }),
    createEvent("MandateSuspended", { ...common, actor: system, subject: { type: "mandate", id: mnd }, payload: { reason: "anomaly" } }),
    createEvent("MandateRevoked", { ...common, actor: human, subject: { type: "mandate", id: mnd }, payload: { revokedBy: maya, reason: "vendor dispute" } }),
    createEvent("SpendEscalated", { ...common, actor: system, subject: { type: "spendIntent", id: spi }, payload: { policyDecisionId: pol, mandateId: mnd, amount: usdc } }),
    createEvent("SettlementFailed", { ...common, actor: system, subject: { type: "settlement", id: stl }, payload: { transactionId: tx, reason: "blockhash expired" } }),
    createEvent("SpendSubmitted", { ...common, actor: system, subject: { type: "spendIntent", id: spi }, payload: { transactionId: tx, signature: sig } }),
    createEvent("TwinUpdated", { ...common, actor: system, subject: { type: "company", id: company }, payload: { forecastId: f, scenarioId: parseId("scenario", ids["scenarioBaseline"]), cause: "scenario_changed", runwayMonths: null } }),
  ];
  for (const e of built) assert.ok(DomainEventSchema.safeParse(e).success);
});
