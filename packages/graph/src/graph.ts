import { z } from "zod";
import { verifyAuditChain } from "./audit";
import {
  AgentSchema, AuditEventSchema, BudgetSchema, CompanySchema, ContractSchema, ContractVersionSchema, CounterpartySchema,
  DelegationSchema, EvidenceCitationSchema, ForecastSchema, HumanUserSchema, LedgerEntrySchema, MandateSchema, ObligationSchema,
  OrganizationSchema, PolicyDecisionSchema, ScenarioSchema, SettlementSchema, SpendIntentSchema, TaskEconomicsSchema, TransactionSchema,
} from "./entities";

/** A portable, storage-agnostic bundle of every entity collection. Any persistence layer can load/save this shape. */
export const GraphSnapshotSchema = z.object({
  organizations: z.array(OrganizationSchema),
  companies: z.array(CompanySchema),
  users: z.array(HumanUserSchema),
  agents: z.array(AgentSchema),
  counterparties: z.array(CounterpartySchema),
  contracts: z.array(ContractSchema),
  contractVersions: z.array(ContractVersionSchema),
  citations: z.array(EvidenceCitationSchema),
  obligations: z.array(ObligationSchema),
  budgets: z.array(BudgetSchema),
  mandates: z.array(MandateSchema),
  delegations: z.array(DelegationSchema),
  spendIntents: z.array(SpendIntentSchema),
  policyDecisions: z.array(PolicyDecisionSchema),
  transactions: z.array(TransactionSchema),
  settlements: z.array(SettlementSchema),
  ledgerEntries: z.array(LedgerEntrySchema),
  scenarios: z.array(ScenarioSchema),
  forecasts: z.array(ForecastSchema),
  taskEconomics: z.array(TaskEconomicsSchema),
  auditEvents: z.array(AuditEventSchema),
}).strict();
export type GraphSnapshot = z.infer<typeof GraphSnapshotSchema>;

export type GraphIssueCode =
  | "DUPLICATE_ID" | "MISSING_REFERENCE" | "TENANT_MISMATCH" | "RELATION_MISMATCH"
  | "CURRENCY_MISMATCH" | "STATE_INCONSISTENT" | "AMOUNT_MISMATCH" | "AUDIT_CHAIN_BROKEN";

export interface GraphIssue {
  readonly code: GraphIssueCode;
  readonly entity: string;
  readonly id: string;
  readonly message: string;
}

const APPROVED_OBLIGATION = new Set(["approved", "active", "fulfilled"]);
const SPEND_PAST_DECISION = new Set(["approved", "submitted", "settled", "failed"]);

/**
 * Cross-entity integrity: referential integrity, tenant isolation and the product's cross-object guarantees.
 * Schemas validate one object; this validates the relationships between them. Returns [] when sound.
 * Pure and storage-agnostic: run it on a snapshot, after a migration, or in CI against a fixture.
 */
export function validateGraph(g: GraphSnapshot): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const add = (code: GraphIssueCode, entity: string, id: string, message: string): void => { issues.push({ code, entity, id, message }); };

  const index = <T extends { readonly id: string }>(entity: string, items: readonly T[]): Map<string, T> => {
    const m = new Map<string, T>();
    for (const it of items) {
      if (m.has(it.id)) add("DUPLICATE_ID", entity, it.id, "duplicate id");
      m.set(it.id, it);
    }
    return m;
  };
  const orgs = index("organization", g.organizations);
  const companies = index("company", g.companies);
  const users = index("user", g.users);
  const agents = index("agent", g.agents);
  const cps = index("counterparty", g.counterparties);
  const contracts = index("contract", g.contracts);
  const versions = index("contractVersion", g.contractVersions);
  const citations = index("citation", g.citations);
  const obligations = index("obligation", g.obligations);
  const budgets = index("budget", g.budgets);
  const mandates = index("mandate", g.mandates);
  index("delegation", g.delegations);
  const intents = index("spendIntent", g.spendIntents);
  const decisions = index("policyDecision", g.policyDecisions);
  const txs = index("transaction", g.transactions);
  const settlements = index("settlement", g.settlements);
  const ledger = index("ledgerEntry", g.ledgerEntries);
  const scenarios = index("scenario", g.scenarios);
  index("forecast", g.forecasts);
  index("taskEconomics", g.taskEconomics);
  index("auditEvent", g.auditEvents);

  /** Resolve a reference; records MISSING_REFERENCE and returns undefined if absent. */
  const ref = <T>(m: Map<string, T>, target: string | null, entity: string, owner: string, field: string): T | undefined => {
    if (target === null) return undefined;
    const found = m.get(target);
    if (!found) add("MISSING_REFERENCE", entity, owner, `${field} -> ${target} not found`);
    return found;
  };
  const sameTenant = (entity: string, id: string, field: string, companyId: string, other: { readonly companyId: string } | undefined): void => {
    if (other && other.companyId !== companyId) add("TENANT_MISMATCH", entity, id, `${field} belongs to a different company`);
  };
  const eq = (entity: string, id: string, what: string, a: unknown, b: unknown): void => {
    if (a !== b) add("RELATION_MISMATCH", entity, id, `${what} does not match (${String(a)} vs ${String(b)})`);
  };
  const orgOf = (companyId: string): string | undefined => companies.get(companyId)?.organizationId;

  for (const c of g.companies) ref(orgs, c.organizationId, "company", c.id, "organizationId");
  for (const u of g.users) ref(orgs, u.organizationId, "user", u.id, "organizationId");

  const company = (entity: string, id: string, companyId: string) => ref(companies, companyId, entity, id, "companyId");
  const userInOrg = (entity: string, id: string, companyId: string, userId: string): void => {
    const u = ref(users, userId, entity, id, "userId");
    const org = orgOf(companyId);
    if (u && org && u.organizationId !== org) add("TENANT_MISMATCH", entity, id, `user ${userId} belongs to a different organization`);
  };

  for (const a of g.agents) {
    company("agent", a.id, a.companyId);
    userInOrg("agent", a.id, a.companyId, a.ownerUserId);
  }
  for (const c of g.counterparties) company("counterparty", c.id, c.companyId);

  for (const c of g.contracts) {
    company("contract", c.id, c.companyId);
    sameTenant("contract", c.id, "counterparty", c.companyId, ref(cps, c.counterpartyId, "contract", c.id, "counterpartyId"));
    const v = ref(versions, c.currentVersionId, "contract", c.id, "currentVersionId");
    if (v) {
      eq("contract", c.id, "currentVersion.contractId", v.contractId, c.id);
      const needsTerms = ["extracted", "in_review", "active", "expired", "terminated"].includes(c.status);
      if (needsTerms && v.extraction.status !== "succeeded") add("STATE_INCONSISTENT", "contract", c.id, `status ${c.status} requires successful extraction on the current version`);
    }
    if (c.status === "active") {
      for (const o of g.obligations) {
        if (o.contractId === c.id && o.material && o.status === "proposed") add("STATE_INCONSISTENT", "contract", c.id, `active contract has unapproved material obligation ${o.id}`);
      }
    }
  }
  for (const v of g.contractVersions) {
    const c = ref(contracts, v.contractId, "contractVersion", v.id, "contractId");
    eq("contractVersion", v.id, "companyId", v.companyId, c?.companyId ?? v.companyId);
    userInOrg("contractVersion", v.id, v.companyId, v.uploadedBy);
  }
  for (const c of g.citations) {
    const v = ref(versions, c.contractVersionId, "citation", c.id, "contractVersionId");
    sameTenant("citation", c.id, "contractVersion", c.companyId, v);
  }
  for (const o of g.obligations) {
    company("obligation", o.id, o.companyId);
    const c = ref(contracts, o.contractId, "obligation", o.id, "contractId");
    sameTenant("obligation", o.id, "contract", o.companyId, c);
    if (c) eq("obligation", o.id, "counterpartyId", o.counterpartyId, c.counterpartyId);
    const v = ref(versions, o.contractVersionId, "obligation", o.id, "contractVersionId");
    if (v) eq("obligation", o.id, "contractVersion.contractId", v.contractId, o.contractId);
    for (const cid of o.citationIds) {
      const cit = ref(citations, cid, "obligation", o.id, "citationIds");
      if (cit) eq("obligation", o.id, `citation ${cid} contractVersionId`, cit.contractVersionId, o.contractVersionId);
    }
    if (o.review) userInOrg("obligation", o.id, o.companyId, o.review.byUserId);
  }
  for (const b of g.budgets) {
    company("budget", b.id, b.companyId);
    sameTenant("budget", b.id, "contract", b.companyId, ref(contracts, b.contractId, "budget", b.id, "contractId"));
    sameTenant("budget", b.id, "agent", b.companyId, ref(agents, b.agentId, "budget", b.id, "agentId"));
  }

  for (const m of g.mandates) {
    company("mandate", m.id, m.companyId);
    const c = ref(contracts, m.contractId, "mandate", m.id, "contractId");
    sameTenant("mandate", m.id, "contract", m.companyId, c);
    if (c) {
      eq("mandate", m.id, "counterpartyId", m.counterpartyId, c.counterpartyId);
      if ((m.status === "active" || m.status === "approved") && c.status !== "active") add("STATE_INCONSISTENT", "mandate", m.id, `mandate ${m.status} but contract is ${c.status}`);
    }
    sameTenant("mandate", m.id, "delegateAgent", m.companyId, ref(agents, m.delegateAgentId, "mandate", m.id, "delegateAgentId"));
    const b = ref(budgets, m.budgetId, "mandate", m.id, "budgetId");
    sameTenant("mandate", m.id, "budget", m.companyId, b);
    if (b && b.limit.currency !== m.limits.total.currency) add("CURRENCY_MISMATCH", "mandate", m.id, "budget currency differs from mandate currency");
    for (const oid of m.obligationIds) {
      const o = ref(obligations, oid, "mandate", m.id, "obligationIds");
      if (!o) continue;
      eq("mandate", m.id, `obligation ${oid} contractId`, o.contractId, m.contractId);
      if (m.status !== "proposed" && m.status !== "rejected" && !APPROVED_OBLIGATION.has(o.status)) add("STATE_INCONSISTENT", "mandate", m.id, `mandate ${m.status} but obligation ${oid} is ${o.status}`);
    }
    for (const ap of m.approvals) userInOrg("mandate", m.id, m.companyId, ap.userId);
  }
  for (const d of g.delegations) {
    company("delegation", d.id, d.companyId);
    const m = ref(mandates, d.mandateId, "delegation", d.id, "mandateId");
    if (m) eq("delegation", d.id, "agentId vs mandate delegate", d.agentId, m.delegateAgentId);
    userInOrg("delegation", d.id, d.companyId, d.grantedBy);
  }

  for (const s of g.spendIntents) {
    company("spendIntent", s.id, s.companyId);
    const m = ref(mandates, s.mandateId, "spendIntent", s.id, "mandateId");
    sameTenant("spendIntent", s.id, "mandate", s.companyId, m);
    if (m) {
      eq("spendIntent", s.id, "agentId vs mandate delegate", s.agentId, m.delegateAgentId);
      eq("spendIntent", s.id, "counterpartyId vs mandate", s.counterpartyId, m.counterpartyId);
      if (s.amount.currency !== m.limits.total.currency) add("CURRENCY_MISMATCH", "spendIntent", s.id, "amount currency differs from mandate currency");
      if (s.obligationId && !m.obligationIds.includes(s.obligationId)) add("RELATION_MISMATCH", "spendIntent", s.id, "obligationId is not covered by the mandate");
    }
    const d = ref(decisions, s.policyDecisionId, "spendIntent", s.id, "policyDecisionId");
    if (d) {
      eq("spendIntent", s.id, "decision.spendIntentId", d.spendIntentId, s.id);
      eq("spendIntent", s.id, "decision.mandateId", d.mandateId, s.mandateId);
      if (SPEND_PAST_DECISION.has(s.status) && d.outcome === "deny") add("STATE_INCONSISTENT", "spendIntent", s.id, `status ${s.status} but policy outcome is deny (a denied spend can never proceed)`);
      if (s.status === "pending_human_approval" && d.outcome !== "require_human_approval") add("STATE_INCONSISTENT", "spendIntent", s.id, "pending_human_approval requires an escalation decision");
      if (s.status === "blocked" && d.outcome === "allow") add("STATE_INCONSISTENT", "spendIntent", s.id, "blocked intent carries an allow decision");
    }
    const hasTx = g.transactions.some((t) => t.spendIntentId === s.id);
    if (s.status === "blocked" && hasTx) add("STATE_INCONSISTENT", "spendIntent", s.id, "a blocked spend must never have a transaction");
    if ((s.status === "submitted" || s.status === "settled") && !hasTx) add("STATE_INCONSISTENT", "spendIntent", s.id, `status ${s.status} requires a transaction`);
  }
  for (const d of g.policyDecisions) {
    company("policyDecision", d.id, d.companyId);
    sameTenant("policyDecision", d.id, "spendIntent", d.companyId, ref(intents, d.spendIntentId, "policyDecision", d.id, "spendIntentId"));
  }
  for (const t of g.transactions) {
    company("transaction", t.id, t.companyId);
    const s = ref(intents, t.spendIntentId, "transaction", t.id, "spendIntentId");
    sameTenant("transaction", t.id, "spendIntent", t.companyId, s);
    if (s) {
      if (t.amount.amountMinor !== s.amount.amountMinor || t.amount.currency !== s.amount.currency) add("AMOUNT_MISMATCH", "transaction", t.id, "transaction amount differs from spend intent amount");
      if (!SPEND_PAST_DECISION.has(s.status)) add("STATE_INCONSISTENT", "transaction", t.id, `spend intent is ${s.status}; only approved spends may have transactions`);
    }
  }

  for (const st of g.settlements) {
    company("settlement", st.id, st.companyId);
    const tx = ref(txs, st.transactionId, "settlement", st.id, "transactionId");
    const si = ref(intents, st.spendIntentId, "settlement", st.id, "spendIntentId");
    const m = ref(mandates, st.mandateId, "settlement", st.id, "mandateId");
    if (tx) {
      eq("settlement", st.id, "transaction.spendIntentId", tx.spendIntentId, st.spendIntentId);
      if (tx.amount.amountMinor !== st.settledAmount.amountMinor || tx.amount.currency !== st.settledAmount.currency) add("AMOUNT_MISMATCH", "settlement", st.id, "settled amount differs from transaction amount");
      if (["confirmed", "finalized", "reconciled"].includes(st.status) && tx.status !== "confirmed") add("STATE_INCONSISTENT", "settlement", st.id, `settlement ${st.status} but transaction is ${tx.status}`);
    }
    if (si) {
      eq("settlement", st.id, "agentId", st.agentId, si.agentId);
      eq("settlement", st.id, "taskId", st.taskId, si.taskId);
      eq("settlement", st.id, "counterpartyId", st.counterpartyId, si.counterpartyId);
      eq("settlement", st.id, "obligationId", st.obligationId, si.obligationId);
      eq("settlement", st.id, "mandateId", st.mandateId, si.mandateId);
      if (si.amount.amountMinor !== st.settledAmount.amountMinor) add("AMOUNT_MISMATCH", "settlement", st.id, "settled amount differs from approved spend amount");
      if (st.status === "reconciled" && si.status !== "settled") add("STATE_INCONSISTENT", "settlement", st.id, `reconciled settlement but spend intent is ${si.status}`);
    }
    if (m) eq("settlement", st.id, "contractId vs mandate", st.contractId, m.contractId);
    if (st.status === "reconciled" && !g.ledgerEntries.some((e) => e.links.settlementId === st.id)) add("STATE_INCONSISTENT", "settlement", st.id, "reconciled settlement has no ledger entries");
  }

  const seqByCompany = new Map<string, number>();
  for (const e of [...g.ledgerEntries].sort((a, b) => a.sequence - b.sequence)) {
    company("ledgerEntry", e.id, e.companyId);
    const expected = (seqByCompany.get(e.companyId) ?? 0) + 1;
    if (e.sequence !== expected) add("STATE_INCONSISTENT", "ledgerEntry", e.id, `sequence ${e.sequence} breaks gapless order (expected ${expected})`);
    seqByCompany.set(e.companyId, e.sequence);
    ref(ledger, e.reverses, "ledgerEntry", e.id, "reverses");
    const st = ref(settlements, e.links.settlementId, "ledgerEntry", e.id, "links.settlementId");
    if (st) {
      sameTenant("ledgerEntry", e.id, "settlement", e.companyId, st);
      eq("ledgerEntry", e.id, "links.contractId", e.links.contractId, st.contractId);
      eq("ledgerEntry", e.id, "links.mandateId", e.links.mandateId, st.mandateId);
      eq("ledgerEntry", e.id, "links.agentId", e.links.agentId, st.agentId);
      eq("ledgerEntry", e.id, "links.taskId", e.links.taskId, st.taskId);
      eq("ledgerEntry", e.id, "links.obligationId", e.links.obligationId, st.obligationId);
      if (e.amount.currency !== st.settledAmount.currency) add("CURRENCY_MISMATCH", "ledgerEntry", e.id, "entry currency differs from settlement currency");
    }
  }

  for (const sc of g.scenarios) {
    company("scenario", sc.id, sc.companyId);
    for (const oid of sc.includedObligationIds) sameTenant("scenario", sc.id, "obligation", sc.companyId, ref(obligations, oid, "scenario", sc.id, "includedObligationIds"));
  }
  for (const f of g.forecasts) {
    company("forecast", f.id, f.companyId);
    const sc = ref(scenarios, f.scenarioId, "forecast", f.id, "scenarioId");
    if (sc) {
      sameTenant("forecast", f.id, "scenario", f.companyId, sc);
      if (sc.assumptions.openingCash.currency !== f.currency) add("CURRENCY_MISMATCH", "forecast", f.id, "forecast currency differs from scenario currency");
    }
  }
  for (const t of g.taskEconomics) {
    company("taskEconomics", t.id, t.companyId);
    sameTenant("taskEconomics", t.id, "agent", t.companyId, ref(agents, t.agentId, "taskEconomics", t.id, "agentId"));
    for (const sid of t.spendIntentIds) {
      const si = ref(intents, sid, "taskEconomics", t.id, "spendIntentIds");
      if (si) { eq("taskEconomics", t.id, `spendIntent ${sid} taskId`, si.taskId, t.taskId); eq("taskEconomics", t.id, `spendIntent ${sid} agentId`, si.agentId, t.agentId); }
    }
    let total = 0n;
    for (const sid of t.settlementIds) {
      const st = ref(settlements, sid, "taskEconomics", t.id, "settlementIds");
      if (!st) continue;
      eq("taskEconomics", t.id, `settlement ${sid} taskId`, st.taskId, t.taskId);
      if (st.settledAmount.currency !== t.totalCost.currency) add("CURRENCY_MISMATCH", "taskEconomics", t.id, `settlement ${sid} currency differs`);
      else if (st.status !== "failed") total += BigInt(st.settledAmount.amountMinor);
    }
    if (total !== BigInt(t.totalCost.amountMinor)) add("AMOUNT_MISMATCH", "taskEconomics", t.id, `totalCost ${t.totalCost.amountMinor} != sum of non-failed settlements ${total}`);
  }

  const chains = new Map<string, typeof g.auditEvents>();
  for (const a of g.auditEvents) {
    company("auditEvent", a.id, a.companyId);
    chains.set(a.companyId, [...(chains.get(a.companyId) ?? []), a]);
  }
  for (const [companyId, chain] of chains) {
    const r = verifyAuditChain([...chain].sort((x, y) => x.sequence - y.sequence));
    if (!r.ok) add("AUDIT_CHAIN_BROKEN", "auditEvent", companyId, r.error.message);
  }
  return issues;
}
