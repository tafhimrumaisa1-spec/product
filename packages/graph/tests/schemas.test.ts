type Parser = { safeParse(v: unknown): { success: boolean } };
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AgentSchema, ContractVersionSchema, DelegationSchema, EvidenceCitationSchema, ExtractedTermsSchema, ForecastSchema,
  HumanUserSchema, LedgerEntrySchema, MandateSchema, ObligationSchema, OrganizationSchema, PolicyDecisionSchema,
  ScenarioSchema, SettlementSchema, SpendIntentSchema, TaskEconomicsSchema, TransactionSchema, AuditEventSchema,
  BudgetSchema, CompanySchema, ContractSchema, CounterpartySchema, FIXTURE,
} from "../src/index";
import { clone } from "./helpers";

const g = FIXTURE.graph;
const first = <T>(a: readonly T[]): T => a[0]!;

test("every fixture entity parses under its own schema (all 21 entity types covered)", () => {
  const pairs: [string, Parser, readonly unknown[]][] = [
    ["Organization", OrganizationSchema, g.organizations], ["Company", CompanySchema, g.companies], ["HumanUser", HumanUserSchema, g.users],
    ["Agent", AgentSchema, g.agents], ["Counterparty", CounterpartySchema, g.counterparties], ["Contract", ContractSchema, g.contracts],
    ["ContractVersion", ContractVersionSchema, g.contractVersions], ["EvidenceCitation", EvidenceCitationSchema, g.citations],
    ["Obligation", ObligationSchema, g.obligations], ["Budget", BudgetSchema, g.budgets], ["Mandate", MandateSchema, g.mandates],
    ["Delegation", DelegationSchema, g.delegations], ["SpendIntent", SpendIntentSchema, g.spendIntents],
    ["PolicyDecision", PolicyDecisionSchema, g.policyDecisions], ["Transaction", TransactionSchema, g.transactions],
    ["Settlement", SettlementSchema, g.settlements], ["LedgerEntry", LedgerEntrySchema, g.ledgerEntries], ["Forecast", ForecastSchema, g.forecasts],
    ["Scenario", ScenarioSchema, g.scenarios], ["TaskEconomics", TaskEconomicsSchema, g.taskEconomics], ["AuditEvent", AuditEventSchema, g.auditEvents],
  ];
  assert.equal(pairs.length, 21);
  for (const [name, schema, items] of pairs) {
    assert.ok(items.length > 0, `${name} has fixture coverage`);
    for (const it of items) assert.ok(schema.safeParse(it).success, `${name} fixture parses`);
  }
});

test("all schemas are strict: unknown keys (e.g. a smuggled secret) are rejected", () => {
  const targets: [Parser, unknown][] = [
    [AgentSchema, first(g.agents)], [HumanUserSchema, first(g.users)], [MandateSchema, first(g.mandates)], [TransactionSchema, first(g.transactions)],
    [ContractVersionSchema, first(g.contractVersions)], [SettlementSchema, first(g.settlements)], [CounterpartySchema, first(g.counterparties)],
  ];
  for (const [schema, value] of targets) {
    assert.ok(!schema.safeParse({ ...(value as object), privateKey: "S3CR3T" }).success);
  }
});

test("security: an agent can never be modelled as holding a treasury key", () => {
  const a = clone(first(g.agents));
  assert.ok(AgentSchema.safeParse(a).success);
  assert.ok(!AgentSchema.safeParse({ ...a, holdsTreasuryKey: true }).success);
});

test("security: only synthetic orgs and devnet/localnet transactions are representable", () => {
  assert.ok(!OrganizationSchema.safeParse({ ...first(g.organizations), environment: "production" }).success);
  assert.ok(!TransactionSchema.safeParse({ ...first(g.transactions), cluster: "mainnet-beta" }).success);
  assert.ok(!MandateSchema.safeParse({ ...first(g.mandates), registry: { ...first(g.mandates).registry!, network: "solana-mainnet" } }).success);
});

test("contract terms: date order and renewal consistency", () => {
  const terms = clone(first(g.contractVersions).extraction.terms!);
  assert.ok(!ExtractedTermsSchema.safeParse({ ...terms, endDate: terms.startDate }).success);
  assert.ok(!ExtractedTermsSchema.safeParse({ ...terms, renewal: { autoRenew: true, noticeDays: 1, renewalTermMonths: null } }).success);
  assert.ok(!ExtractedTermsSchema.safeParse({ ...terms, paymentSchedule: [] }).success);
});

test("contract version: extraction states carry exactly the fields they should", () => {
  const v = clone(first(g.contractVersions));
  assert.ok(ContractVersionSchema.safeParse({ ...v, extraction: { status: "pending", model: null, terms: null, termsCommitment: null, extractedAt: null, failureReason: null } }).success);
  assert.ok(!ContractVersionSchema.safeParse({ ...v, extraction: { status: "pending", model: null, terms: v.extraction.terms, termsCommitment: null, extractedAt: null, failureReason: null } }).success, "pending with terms");
  assert.ok(!ContractVersionSchema.safeParse({ ...v, extraction: { status: "failed", model: null, terms: null, termsCommitment: null, extractedAt: null, failureReason: null } }).success, "failed needs a reason");
  assert.ok(!ContractVersionSchema.safeParse({ ...v, documentRef: "https://evil.example/contract.pdf" }).success, "documentRef must be a vault:// pointer");
});

test("citation: offsets and confidence are bounded", () => {
  const c = clone(first(g.citations));
  assert.ok(!EvidenceCitationSchema.safeParse({ ...c, endOffset: c.startOffset }).success);
  assert.ok(!EvidenceCitationSchema.safeParse({ ...c, confidence: 1.2 }).success);
  assert.ok(!EvidenceCitationSchema.safeParse({ ...c, pageNumber: 0 }).success);
});

test("obligation: review must agree with status; kind-specific fields required", () => {
  const o = clone(first(g.obligations)); // active, human-approved
  assert.ok(!ObligationSchema.safeParse({ ...o, review: null }).success, "active without human approval");
  assert.ok(!ObligationSchema.safeParse({ ...o, status: "proposed" }).success, "proposed with a review");
  assert.ok(!ObligationSchema.safeParse({ ...o, review: { ...o.review!, decision: "rejected" } }).success, "approved status with rejecting review");
  assert.ok(ObligationSchema.safeParse({ ...o, status: "rejected", review: { ...o.review!, decision: "rejected" } }).success);
  assert.ok(!ObligationSchema.safeParse({ ...o, citationIds: [] }).success, "evidence required");
  assert.ok(!ObligationSchema.safeParse({ ...o, amount: null }).success, "payment needs amount");
  const notice = clone(g.obligations[2]!);
  assert.ok(!ObligationSchema.safeParse({ ...notice, noticeDays: null }).success, "notice kinds need noticeDays");
  assert.ok(!ObligationSchema.safeParse({ ...o, review: { ...o.review!, byUserId: first(g.agents).id } }).success, "reviewer must be a user id, never an agent id");
});

test("mandate: invariants for approval, activation, limits and proposer", () => {
  const m = clone(first(g.mandates)); // active
  assert.ok(!MandateSchema.safeParse({ ...m, approvals: [] }).success, "active needs a human approval");
  assert.ok(!MandateSchema.safeParse({ ...m, registry: null }).success, "active needs on-chain registry evidence");
  assert.ok(!MandateSchema.safeParse({ ...m, validUntil: m.validFrom }).success);
  assert.ok(!MandateSchema.safeParse({ ...m, limits: { ...m.limits, perTransaction: m.limits.total, perPeriod: { ...m.limits.perPeriod, amount: { amountMinor: "1", currency: "USDC" } } } }).success, "perTransaction > perPeriod");
  assert.ok(!MandateSchema.safeParse({ ...m, limits: { ...m.limits, perTransaction: { amountMinor: "1", currency: "USD" } } }).success, "mixed currency");
  assert.ok(!MandateSchema.safeParse({ ...m, proposedBy: { type: "agent", id: m.delegateAgentId } }).success, "agent cannot propose own mandate");
  assert.ok(!MandateSchema.safeParse({ ...m, obligationIds: [] }).success);
  assert.ok(!MandateSchema.safeParse({ ...m, approvals: [{ userId: m.delegateAgentId, at: m.createdAt }] }).success, "approver must be a user id");
  assert.ok(MandateSchema.safeParse({ ...m, status: "proposed", approvals: [], registry: null }).success);
});

test("spend intent: decisions required once past evaluation; zero amounts rejected", () => {
  const s = clone(first(g.spendIntents)); // settled
  assert.ok(!SpendIntentSchema.safeParse({ ...s, policyDecisionId: null }).success);
  assert.ok(!SpendIntentSchema.safeParse({ ...s, amount: { amountMinor: "0", currency: "USDC" } }).success);
  assert.ok(SpendIntentSchema.safeParse({ ...s, status: "requested", policyDecisionId: null }).success);
  assert.ok(!SpendIntentSchema.safeParse({ ...s, idempotencyKey: "short" }).success);
});

test("policy decision: outcome and reasons must agree; evaluator is deterministic code only", () => {
  const allow = clone(g.policyDecisions[0]!);
  const deny = clone(g.policyDecisions[1]!);
  assert.ok(!PolicyDecisionSchema.safeParse({ ...allow, reasons: deny.reasons }).success, "allow with violations");
  assert.ok(!PolicyDecisionSchema.safeParse({ ...deny, reasons: allow.reasons }).success, "deny without violations");
  assert.ok(!PolicyDecisionSchema.safeParse({ ...allow, outcome: "require_human_approval" }).success, "escalation must cite HUMAN_APPROVAL_REQUIRED");
  assert.ok(PolicyDecisionSchema.safeParse({ ...allow, outcome: "require_human_approval", reasons: [{ code: "HUMAN_APPROVAL_REQUIRED", severity: "info", message: "above threshold" }] }).success);
  assert.ok(!PolicyDecisionSchema.safeParse({ ...allow, evaluator: { kind: "llm", version: "x" } }).success, "an LLM can never be the evaluator");
  assert.ok(!PolicyDecisionSchema.safeParse({ ...allow, reasons: [] }).success);
});

test("transaction and settlement: evidence required for each stage", () => {
  const t = clone(first(g.transactions));
  assert.ok(!TransactionSchema.safeParse({ ...t, signature: null }).success);
  assert.ok(!TransactionSchema.safeParse({ ...t, slot: null }).success);
  assert.ok(TransactionSchema.safeParse({ ...t, status: "built", signature: null, slot: null }).success);
  const s = clone(first(g.settlements));
  assert.ok(!SettlementSchema.safeParse({ ...s, reconciledAt: null }).success);
  assert.ok(!SettlementSchema.safeParse({ ...s, finalizedAt: null }).success);
  assert.ok(!SettlementSchema.safeParse({ ...s, status: "failed" }).success, "failed needs reason and no stale timestamps are required, but reason is");
  assert.ok(!SettlementSchema.safeParse({ ...s, failureReason: "x" }).success, "reason only when failed");
});

test("ledger entry: balanced single line, positive amount, distinct accounts", () => {
  const e = clone(first(g.ledgerEntries));
  assert.ok(!LedgerEntrySchema.safeParse({ ...e, creditAccount: e.debitAccount }).success);
  assert.ok(!LedgerEntrySchema.safeParse({ ...e, amount: { amountMinor: "0", currency: "USDC" } }).success);
  assert.ok(!LedgerEntrySchema.safeParse({ ...e, sequence: 0 }).success);
  assert.ok(!LedgerEntrySchema.safeParse({ ...e, debitAccount: "made_up" }).success);
});

test("forecast: arithmetic, continuity and consecutive months are enforced", () => {
  const f = clone(g.forecasts[1]!);
  const bump = (i: number, patch: object) => ({ ...f, points: f.points.map((p, k) => (k === i ? { ...p, ...patch } : p)) });
  assert.ok(!ForecastSchema.safeParse(bump(2, { closingCash: { amountMinor: "1", currency: "USDC" } })).success, "closing != opening + in - out");
  assert.ok(!ForecastSchema.safeParse(bump(3, { openingCash: { amountMinor: "1", currency: "USDC" } })).success, "discontinuous cash");
  assert.ok(!ForecastSchema.safeParse(bump(4, { month: "2030-01" })).success, "non-consecutive month");
  assert.ok(!ForecastSchema.safeParse({ ...f, currency: "USD" }).success, "currency mismatch");
  assert.ok(!ForecastSchema.safeParse({ ...f, points: [] }).success);
  assert.equal(f.runwayMonths, 10);
  assert.equal(f.points[9]!.closingCash.amountMinor, "0");
});

test("scenario, delegation, budget, task economics, audit event edge rules", () => {
  const sc = clone(g.scenarios[0]!);
  assert.ok(!ScenarioSchema.safeParse({ ...sc, includedObligationIds: [first(g.obligations).id] }).success, "baseline includes none");
  assert.ok(!ScenarioSchema.safeParse({ ...sc, assumptions: { ...sc.assumptions, monthlyRevenue: { amountMinor: "1", currency: "USD" } } }).success);
  const d = clone(first(g.delegations));
  assert.ok(!DelegationSchema.safeParse({ ...d, status: "revoked" }).success);
  assert.ok(!DelegationSchema.safeParse({ ...d, revokedAt: d.createdAt }).success);
  const b = clone(first(g.budgets));
  assert.ok(!BudgetSchema.safeParse({ ...b, contractId: null }).success);
  assert.ok(!BudgetSchema.safeParse({ ...b, periodEnd: "2026-01-01" }).success);
  const t = clone(first(g.taskEconomics));
  assert.ok(!TaskEconomicsSchema.safeParse({ ...t, attributedRevenue: { amountMinor: "1", currency: "USD" } }).success);
  const a = clone(first(g.auditEvents));
  assert.ok(!AuditEventSchema.safeParse({ ...a, prevHash: a.hash }).success, "sequence 1 must have null prevHash");
  const second = clone(g.auditEvents[1]!);
  assert.ok(!AuditEventSchema.safeParse({ ...second, prevHash: null }).success);
});

test("mutable entities: updatedAt may not precede createdAt", () => {
  const c = clone(first(g.contracts));
  assert.ok(!ContractSchema.safeParse({ ...c, updatedAt: "2020-01-01T00:00:00Z" }).success);
  assert.ok(!ContractSchema.safeParse({ ...c, revision: 0 }).success);
});
