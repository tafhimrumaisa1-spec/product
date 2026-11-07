import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildAuditChain, buildAuditEvent, buildFixture, commit, FIXTURE, FIXTURE_SALT, FluxGraphError, GraphSnapshotSchema, serialize, deserialize,
  syntheticBase58, validateGraph, verifyAuditChain, verifyCommitment, advanceContract, advanceMandate, advanceObligation, advanceSettlement,
  advanceSpendIntent, SolanaAddress, SolanaSignature, canonicalize, parseId, createEvent, type GraphSnapshot, type GraphIssueCode,
} from "../src/index";
import { ai, clone, human, system, agent, AT } from "./helpers";

const fresh = (): GraphSnapshot => clone(FIXTURE.graph);
const codes = (g: GraphSnapshot): GraphIssueCode[] => validateGraph(g).map((i) => i.code);
const expectIssue = (mutate: (g: GraphSnapshot) => void, code: GraphIssueCode, label: string) => {
  const g = fresh();
  mutate(g);
  assert.ok(codes(g).includes(code), `${label}: expected ${code}, got ${JSON.stringify(codes(g))}`);
};

test("fixture: deterministic across builds, parses as a snapshot, passes integrity validation", () => {
  const a = buildFixture();
  const b = buildFixture();
  assert.equal(canonicalize(a), canonicalize(b), "byte-identical across builds");
  assert.equal(canonicalize(a), canonicalize(FIXTURE));
  assert.ok(GraphSnapshotSchema.safeParse(FIXTURE.graph).success);
  assert.deepEqual(validateGraph(FIXTURE.graph), []);
});

test("fixture tells the golden-demo story", () => {
  const g = FIXTURE.graph;
  assert.equal(g.contracts[0]!.status, "active");
  assert.ok(g.obligations.every((o) => o.status === "active" && o.review?.decision === "approved"));
  assert.equal(g.mandates[0]!.status, "active");
  assert.deepEqual(g.spendIntents.map((s) => s.status), ["settled", "blocked"]);
  assert.equal(g.policyDecisions[1]!.outcome, "deny");
  assert.equal(g.transactions.length, 1, "blocked spend has no transaction");
  assert.equal(g.settlements[0]!.status, "reconciled");
  assert.equal(g.ledgerEntries.length, 2);
  assert.deepEqual(g.forecasts.map((f) => f.runwayMonths), [null, 10]);
  assert.equal(g.transactions[0]!.cluster, "devnet");
  assert.ok(g.agents.every((a) => a.holdsTreasuryKey === false));
});

test("fixture placeholders look like addresses/signatures but are labelled synthetic and deterministic", () => {
  assert.equal(syntheticBase58("x", 44), syntheticBase58("x", 44));
  assert.notEqual(syntheticBase58("x", 44), syntheticBase58("y", 44));
  assert.ok(SolanaAddress.safeParse(syntheticBase58("x", 44)).success);
  assert.ok(SolanaSignature.safeParse(syntheticBase58("x", 88)).success);
  assert.ok(verifyCommitment(FIXTURE.graph.citations[0]!.excerptCommitment, FIXTURE.graph.citations[0]!.excerpt, FIXTURE_SALT));
  assert.ok(!verifyCommitment(FIXTURE.graph.citations[0]!.excerptCommitment, "tampered", FIXTURE_SALT));
  assert.notEqual(commit("a", FIXTURE_SALT), commit("a", "0".repeat(32)));
});

test("fixture replay: golden path is reproducible through the public state-machine API", () => {
  const g = FIXTURE.graph;
  // Spend A: requested -> evaluating -> approved -> submitted -> settled
  let s = { ...g.spendIntents[0]!, status: "requested" as const, policyDecisionId: null, revision: 1, updatedAt: g.spendIntents[0]!.createdAt };
  const dec = g.policyDecisions[0]!;
  const steps = [
    () => advanceSpendIntent(s, "BEGIN_EVALUATION", { actor: system, at: AT }),
    () => advanceSpendIntent(s, "ALLOW", { actor: system, at: AT, policyDecisionId: dec.id, policyOutcome: dec.outcome }),
    () => advanceSpendIntent(s, "SUBMIT", { actor: system, at: AT, hasTransaction: true }),
    () => advanceSpendIntent(s, "SETTLE", { actor: system, at: AT }),
  ];
  for (const step of steps) {
    const r = step();
    assert.ok(r.ok);
    if (r.ok) s = r.value.entity as typeof s;
  }
  assert.equal(s.status, g.spendIntents[0]!.status);
  assert.equal(s.revision, g.spendIntents[0]!.revision, "same number of transitions as the fixture");
  // Blocked spend B can never be pushed forward.
  const b = g.spendIntents[1]!;
  for (const t of ["ALLOW", "HUMAN_APPROVE", "SUBMIT", "SETTLE"] as const) {
    assert.ok(!advanceSpendIntent(b, t, { actor: human, at: AT, policyDecisionId: dec.id, policyOutcome: "allow", hasTransaction: true }).ok, `blocked -${t}-`);
  }
  // Terminal fixtures reject everything.
  assert.ok(!advanceSettlement(g.settlements[0]!, "FAIL", { actor: system, at: AT, failureReason: "x" }).ok);
  assert.ok(!advanceContract(g.contracts[0]!, "REJECT", { actor: ai, at: AT }).ok);
  assert.ok(!advanceMandate(g.mandates[0]!, "APPROVE", { actor: ai, at: AT, linkedObligationsApproved: true }).ok);
  assert.ok(!advanceObligation(g.obligations[0]!, "APPROVE", { actor: agent, at: AT, citationCount: 1 }).ok);
});

test("integrity: duplicates, dangling references and tenant crossings are caught", () => {
  expectIssue((g) => g.agents.push(clone(g.agents[0]!)), "DUPLICATE_ID", "duplicate agent");
  expectIssue((g) => { g.spendIntents[0]!.mandateId = parseId("mandate", "mnd_" + "0".repeat(24)); }, "MISSING_REFERENCE", "dangling mandate");
  expectIssue((g) => { g.contracts[0]!.counterpartyId = parseId("counterparty", "cpt_" + "0".repeat(24)); }, "MISSING_REFERENCE", "dangling counterparty");
  expectIssue((g) => {
    const other = clone(g.companies[0]!);
    (other as { id: string }).id = "cmp_" + "1".repeat(24);
    g.companies.push(other);
    g.counterparties[0]!.companyId = other.id;
  }, "TENANT_MISMATCH", "vendor from another company");
  expectIssue((g) => {
    const org = clone(g.organizations[0]!);
    (org as { id: string }).id = "org_" + "2".repeat(24);
    g.organizations.push(org);
    g.users[0]!.organizationId = org.id;
  }, "TENANT_MISMATCH", "approver from another organization");
});

test("integrity: relationship mismatches are caught", () => {
  expectIssue((g) => { g.spendIntents[0]!.agentId = parseId("agent", "agt_" + "3".repeat(24)); }, "RELATION_MISMATCH", "intent agent != mandate delegate");
  expectIssue((g) => { g.delegations[0]!.agentId = parseId("agent", "agt_" + "3".repeat(24)); }, "RELATION_MISMATCH", "delegation agent");
  expectIssue((g) => { g.settlements[0]!.taskId = parseId("task", "tsk_" + "4".repeat(24)); }, "RELATION_MISMATCH", "settlement task");
  expectIssue((g) => { g.ledgerEntries[0]!.links.agentId = parseId("agent", "agt_" + "3".repeat(24)); }, "RELATION_MISMATCH", "ledger agent link");
  expectIssue((g) => { g.obligations[0]!.citationIds = [g.citations[3]!.id]; g.citations[3]!.contractVersionId = parseId("contractVersion", "ctv_" + "5".repeat(24)); }, "MISSING_REFERENCE", "citation of another version");
  expectIssue((g) => { g.mandates[0]!.counterpartyId = parseId("counterparty", "cpt_" + "6".repeat(24)); }, "RELATION_MISMATCH", "mandate counterparty != contract counterparty");
});

test("integrity: the product's cross-object guarantees hold", () => {
  expectIssue((g) => { g.policyDecisions[0]!.outcome = "deny"; g.policyDecisions[0]!.reasons = g.policyDecisions[1]!.reasons; }, "STATE_INCONSISTENT", "settled spend cannot carry a deny");
  expectIssue((g) => { g.spendIntents[1]!.status = "approved"; }, "STATE_INCONSISTENT", "denied spend cannot be approved");
  expectIssue((g) => {
    const t = clone(g.transactions[0]!);
    (t as { id: string }).id = "txn_" + "7".repeat(24);
    t.spendIntentId = g.spendIntents[1]!.id;
    g.transactions.push(t);
  }, "STATE_INCONSISTENT", "blocked spend must never have a transaction");
  expectIssue((g) => { g.transactions.length = 0; }, "MISSING_REFERENCE", "settlement without transaction");
  expectIssue((g) => { g.obligations[1]!.status = "proposed"; g.obligations[1]!.review = null; }, "STATE_INCONSISTENT", "active contract with unapproved material obligation");
  expectIssue((g) => { g.contracts[0]!.status = "in_review"; }, "STATE_INCONSISTENT", "active mandate on a non-active contract");
  expectIssue((g) => { g.ledgerEntries.length = 0; }, "STATE_INCONSISTENT", "reconciled settlement without ledger entries");
  expectIssue((g) => { g.ledgerEntries[1]!.sequence = 5; }, "STATE_INCONSISTENT", "ledger sequence gap");
  expectIssue((g) => { g.transactions[0]!.amount = { amountMinor: "1", currency: "USDC" }; }, "AMOUNT_MISMATCH", "tx amount != intent");
  expectIssue((g) => { g.settlements[0]!.settledAmount = { amountMinor: "1", currency: "USDC" }; }, "AMOUNT_MISMATCH", "settlement amount != tx");
  expectIssue((g) => { g.taskEconomics[0]!.totalCost = { amountMinor: "1", currency: "USDC" }; }, "AMOUNT_MISMATCH", "task cost != sum of settlements");
  expectIssue((g) => { g.spendIntents[0]!.amount = { amountMinor: "8500000000", currency: "USD" }; }, "CURRENCY_MISMATCH", "intent currency");
  expectIssue((g) => { g.forecasts[0]!.currency = "USD"; }, "CURRENCY_MISMATCH", "forecast currency");
  expectIssue((g) => { g.settlements[0]!.status = "confirmed"; g.settlements[0]!.reconciledAt = null; g.transactions[0]!.status = "built"; g.transactions[0]!.signature = null; g.transactions[0]!.slot = null; }, "STATE_INCONSISTENT", "confirmed settlement on unconfirmed tx");
  expectIssue((g) => { g.mandates[0]!.obligationIds = [g.obligations[0]!.id]; g.obligations[0]!.status = "cancelled"; }, "STATE_INCONSISTENT", "active mandate over cancelled obligation");
});

test("audit chain: verifies, and detects edit, deletion, reordering, replacement and cross-company splice", () => {
  const chain = FIXTURE.graph.auditEvents;
  assert.equal(chain.length, FIXTURE.events.length);
  assert.ok(verifyAuditChain(chain).ok);
  assert.ok(verifyAuditChain([]).ok);
  chain.forEach((a, i) => { assert.equal(a.sequence, i + 1); assert.equal(a.domainEventId, FIXTURE.events[i]!.eventId); });
  const broken = (mutate: (c: typeof chain extends readonly (infer T)[] ? T[] : never) => void, label: string) => {
    const c = clone([...chain]);
    mutate(c);
    const r = verifyAuditChain(c);
    assert.ok(!r.ok && r.error.code === "AUDIT_CHAIN_BROKEN", label);
  };
  broken((c) => { c[5]!.eventType = "SpendBlocked"; }, "edited content");
  broken((c) => { c[5]!.actor = { type: "system", id: "someone" }; }, "edited actor");
  broken((c) => { c.splice(7, 1); }, "deleted middle event");
  broken((c) => { c.splice(0, 1); }, "deleted first event");
  broken((c) => { [c[3], c[4]] = [c[4]!, c[3]!]; }, "reordered");
  broken((c) => { c[9]!.hash = c[8]!.hash; }, "replaced hash");
  broken((c) => { c[2]!.companyId = parseId("company", "cmp_" + "9".repeat(24)); }, "company splice");
  assert.deepEqual(buildAuditChain(FIXTURE.events), [...chain], "chain is reproducible from events");
  assert.throws(() => buildAuditEvent(chain[0]!, createEvent("TwinUpdated", { companyId: parseId("company", "cmp_" + "9".repeat(24)), occurredAt: AT, correlationId: "other-company-1", actor: system, subject: { type: "company", id: parseId("company", "cmp_" + "9".repeat(24)) }, payload: { forecastId: FIXTURE.graph.forecasts[0]!.id, scenarioId: FIXTURE.graph.scenarios[0]!.id, cause: "scenario_changed", runwayMonths: null } })), (e: unknown) => e instanceof FluxGraphError && e.code === "AUDIT_CHAIN_BROKEN");
  assert.throws(() => buildAuditEvent(chain.at(-1)!, FIXTURE.events[0]!), /time order/);
});

test("integrity: tampered audit chain surfaces through validateGraph", () => {
  const g = fresh();
  g.auditEvents[4]!.eventType = "SpendBlocked";
  assert.ok(codes(g).includes("AUDIT_CHAIN_BROKEN"));
});

test("snapshot serialization: canonical, round-trips, refuses invalid data", () => {
  const json = serialize(GraphSnapshotSchema, FIXTURE.graph);
  assert.equal(json, canonicalize(FIXTURE.graph));
  const back = deserialize(GraphSnapshotSchema, json);
  assert.ok(back.ok);
  if (back.ok) {
    assert.deepEqual(back.value, FIXTURE.graph);
    assert.deepEqual(validateGraph(back.value), []);
  }
  const bad = fresh();
  (bad.agents[0] as unknown as { holdsTreasuryKey: boolean }).holdsTreasuryKey = true;
  assert.throws(() => serialize(GraphSnapshotSchema, bad), (e: unknown) => e instanceof FluxGraphError && e.code === "SCHEMA_VIOLATION");
  const r = deserialize(GraphSnapshotSchema, JSON.stringify({ ...FIXTURE.graph, secrets: [] }));
  assert.ok(!r.ok && r.error.code === "SCHEMA_VIOLATION", "unknown top-level collections rejected");
  assert.ok(!deserialize(GraphSnapshotSchema, "{").ok);
});

test("security: fixture contains no secret-shaped material and the private excerpt is confined to citations", () => {
  const json = canonicalize(FIXTURE.graph);
  assert.ok(!/privateKey|secretKey|mnemonic|apiKey|password|NEXT_PUBLIC/i.test(json));
  const owners = Object.entries(FIXTURE.graph).filter(([, v]) => JSON.stringify(v).includes(FIXTURE.graph.citations[0]!.excerpt.slice(0, 30))).map(([k]) => k);
  assert.deepEqual(owners, ["citations"]);
});
