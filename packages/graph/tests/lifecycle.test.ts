import assert from "node:assert/strict";
import { test } from "node:test";
import {
  advanceContract, advanceMandate, advanceObligation, advanceSettlement, advanceSpendIntent, availableTriggers,
  CONTRACT_STATUSES, CONTRACT_TRIGGERS, contractMachine, EVENT_TYPES, evaluateTransition, FIXTURE, isTerminal, MANDATE_STATUSES,
  MANDATE_TRIGGERS, mandateMachine, OBLIGATION_STATUSES, OBLIGATION_TRIGGERS, obligationMachine, reachableStates, SETTLEMENT_STATUSES,
  SETTLEMENT_TRIGGERS, settlementMachine, SPEND_INTENT_STATUSES, SPEND_INTENT_TRIGGERS, spendIntentMachine, FluxGraphError,
  parseId, ObligationSchema, type ContractContext, type MandateContext, type MandateRegistry, type ObligationContext,
  type SettlementContext, type SpendIntentContext, type MachineDefinition, type BaseContext, type Actor, type PolicyOutcome,
  type Contract, type Mandate, type Obligation, type SpendIntent, type Settlement,
} from "../src/index";
import { ACTORS, AT, agent, ai, clone, human, system } from "./helpers";

const g = FIXTURE.graph;
const decisionId = parseId("policyDecision", FIXTURE.ids["decisionAllow"]);
const registry: MandateRegistry = clone(g.mandates[0]!.registry!);

/** Every fact true: the most permissive context a caller could supply. Only actor type and structure then decide. */
const fullContract = (actor: Actor): ContractContext => ({ actor, at: AT, extractedTermsPresent: true, materialObligationCount: 4, unapprovedMaterialObligationCount: 0 });
const fullObligation = (actor: Actor): ObligationContext => ({ actor, at: AT, note: "reason", citationCount: 2, contractStatus: "active", outstandingIsZero: true });
const fullMandate = (actor: Actor): MandateContext => ({ actor, at: AT, linkedObligationsApproved: true, registry, reason: "pause" });
const fullSettlement = (actor: Actor): SettlementContext => ({ actor, at: AT, transactionSignaturePresent: true, amountMatchesIntent: true, ledgerEntriesPosted: 2, failureReason: "dropped" });
const fullSpend = (actor: Actor, outcome?: PolicyOutcome): SpendIntentContext => ({ actor, at: AT, policyDecisionId: decisionId, ...(outcome ? { policyOutcome: outcome } : {}), hasTransaction: true });

interface Case<S extends string, T extends string, C extends BaseContext> {
  name: string; machine: MachineDefinition<S, T, C>; states: readonly S[]; triggers: readonly T[]; ctx: (a: Actor, t: T) => C;
}
const outcomeFor = (t: string): PolicyOutcome | undefined => (t === "ALLOW" ? "allow" : t === "DENY" ? "deny" : t === "ESCALATE" ? "require_human_approval" : undefined);
const cases = [
  { name: "Contract", machine: contractMachine, states: CONTRACT_STATUSES, triggers: CONTRACT_TRIGGERS, ctx: (a: Actor) => fullContract(a) },
  { name: "Obligation", machine: obligationMachine, states: OBLIGATION_STATUSES, triggers: OBLIGATION_TRIGGERS, ctx: (a: Actor) => fullObligation(a) },
  { name: "Mandate", machine: mandateMachine, states: MANDATE_STATUSES, triggers: MANDATE_TRIGGERS, ctx: (a: Actor) => fullMandate(a) },
  { name: "SpendIntent", machine: spendIntentMachine, states: SPEND_INTENT_STATUSES, triggers: SPEND_INTENT_TRIGGERS, ctx: (a: Actor, t: string) => fullSpend(a, outcomeFor(t)) },
  { name: "Settlement", machine: settlementMachine, states: SETTLEMENT_STATUSES, triggers: SETTLEMENT_TRIGGERS, ctx: (a: Actor) => fullSettlement(a) },
] as unknown as Case<string, string, BaseContext>[];

for (const c of cases) {
  test(`${c.name}: structure — total table, reachable states, terminal states are dead ends, emits are real events`, () => {
    const m = c.machine;
    assert.deepEqual([...m.states].sort(), [...c.states].sort(), "machine states == status vocabulary");
    assert.deepEqual(new Set(Object.keys(m.transitions)), new Set(m.states), "transition table covers every state");
    assert.deepEqual(reachableStates(m), new Set(m.states), "no unreachable states");
    for (const s of m.terminal) {
      assert.ok(isTerminal(m, s));
      assert.deepEqual(availableTriggers(m, s), [], `${s} has no outgoing triggers`);
    }
    for (const s of m.states.filter((x) => !m.terminal.includes(x))) assert.ok(availableTriggers(m, s).length > 0, `${s} is not a hidden dead end`);
    for (const s of m.states) {
      for (const [trig, spec] of Object.entries(m.transitions[s] ?? {})) {
        assert.ok(c.triggers.includes(trig), `${trig} is a declared trigger`);
        assert.ok(spec && m.states.includes(spec.to), `${s} -${trig}-> ${spec?.to} targets a real state`);
        assert.ok(spec!.emits === null || (EVENT_TYPES as readonly string[]).includes(spec!.emits), `${trig} emits a defined event type`);
        assert.notEqual(spec!.to, s, "no self-loops");
      }
    }
  });

  test(`${c.name}: exhaustive matrix — every (state × trigger × actor) behaves exactly as the table says`, () => {
    let ok = 0, bad = 0;
    for (const s of c.states) for (const t of c.triggers) for (const a of ACTORS) {
      const r = evaluateTransition(c.machine, s, t, c.ctx(a, t));
      const spec = (c.machine.transitions[s] as Record<string, { to: string }> | undefined)?.[t];
      if (r.ok) {
        ok++;
        assert.ok(spec, `${s} -${t}-> must exist in table`);
        assert.equal(r.to, spec!.to);
        assert.equal(r.from, s);
      } else {
        bad++;
        assert.ok(["INVALID_TRANSITION", "TERMINAL_STATE", "GUARD_FAILED"].includes(r.code));
        if (!spec) assert.ok(r.code === "INVALID_TRANSITION" || r.code === "TERMINAL_STATE", `${s} -${t}- not in table must be rejected structurally`);
        else assert.equal(r.code, "GUARD_FAILED");
      }
    }
    assert.ok(ok > 0 && bad > 0);
  });

  test(`${c.name}: unknown states fail closed`, () => {
    const r = evaluateTransition(c.machine, "nonsense", c.triggers[0]!, c.ctx(human, c.triggers[0]!));
    assert.ok(!r.ok && r.code === "UNKNOWN_STATE");
  });
}

test("TRUST MODEL: AI models and agents can never succeed at any approval-type transition, even with every fact supplied", () => {
  const approvalLike = new Set(["ObligationApproved", "ObligationRejected", "ContractActivated", "MandateApproved", "MandateRevoked"]);
  let checked = 0;
  for (const c of cases) {
    for (const s of c.states) for (const [trig, spec] of Object.entries(c.machine.transitions[s] ?? {}) as [string, { emits: string | null }][]) {
      if (!(spec.emits && approvalLike.has(spec.emits)) && !["APPROVE", "REJECT", "HUMAN_APPROVE", "HUMAN_DENY", "RESUME", "TERMINATE", "REVOKE", "BEGIN_REVIEW", "CANCEL"].includes(trig)) continue;
      if (c.name === "SpendIntent" && trig === "CANCEL" && s === "requested") continue; // anyone may withdraw their own pending request
      for (const a of [ai, agent, system]) {
        const r = evaluateTransition(c.machine, s, trig, c.ctx(a, trig));
        if (["APPROVE", "REJECT", "HUMAN_APPROVE", "HUMAN_DENY", "RESUME", "TERMINATE", "BEGIN_REVIEW"].includes(trig) || (trig === "REVOKE") || (trig === "CANCEL" && a !== system)) {
          assert.ok(!r.ok, `${c.name}.${s}.${trig} must reject ${a.type}`);
          checked++;
        }
      }
    }
  }
  assert.ok(checked >= 20, `checked ${checked} combinations`);
});

test("Contract: cannot activate with unapproved, missing or zero material obligations (fail closed)", () => {
  const go = (extra: Partial<ContractContext>) => evaluateTransition(contractMachine, "in_review", "APPROVE", { actor: human, at: AT, ...extra });
  assert.ok(go({ materialObligationCount: 4, unapprovedMaterialObligationCount: 0 }).ok);
  const one = go({ materialObligationCount: 4, unapprovedMaterialObligationCount: 1 });
  assert.ok(!one.ok && one.guardCode === "MATERIAL_OBLIGATIONS_UNAPPROVED");
  const none = go({ materialObligationCount: 0, unapprovedMaterialObligationCount: 0 });
  assert.ok(!none.ok && none.guardCode === "NO_MATERIAL_OBLIGATIONS");
  assert.ok(!go({}).ok, "missing counts => blocked");
  assert.ok(!go({ materialObligationCount: 4 }).ok, "missing unapproved count => blocked");
  const r = evaluateTransition(contractMachine, "extracting", "EXTRACTION_SUCCEEDED", { actor: system, at: AT });
  assert.ok(!r.ok && r.guardCode === "EXTRACTION_RESULT_MISSING");
});

test("Contract: forbidden jumps are rejected (cannot skip extraction or review)", () => {
  for (const [from, trig] of [["uploaded", "APPROVE"], ["extracted", "APPROVE"], ["extracting", "BEGIN_REVIEW"], ["uploaded", "BEGIN_REVIEW"], ["extraction_failed", "APPROVE"], ["in_review", "EXPIRE"], ["active", "BEGIN_REVIEW"]] as const) {
    const r = evaluateTransition(contractMachine, from, trig, fullContract(human));
    assert.ok(!r.ok && r.code === "INVALID_TRANSITION", `${from} -${trig}-> must be invalid`);
  }
  for (const s of ["rejected", "expired", "terminated"] as const) {
    const r = evaluateTransition(contractMachine, s, "APPROVE", fullContract(human));
    assert.ok(!r.ok && r.code === "TERMINAL_STATE");
  }
});

test("Obligation: approval needs evidence, rejection needs a reason; activation needs an active contract", () => {
  const ap = (extra: Partial<ObligationContext>) => evaluateTransition(obligationMachine, "proposed", "APPROVE", { actor: human, at: AT, ...extra });
  assert.ok(ap({ citationCount: 1 }).ok);
  assert.ok(!ap({ citationCount: 0 }).ok);
  assert.ok(!ap({}).ok);
  const rej = (note?: string) => evaluateTransition(obligationMachine, "proposed", "REJECT", { actor: human, at: AT, ...(note !== undefined ? { note } : {}) });
  assert.ok(!rej().ok && !rej("   ").ok && rej("conflicts with schedule").ok);
  const act = (s?: ObligationContext["contractStatus"]) => evaluateTransition(obligationMachine, "approved", "ACTIVATE", { actor: system, at: AT, ...(s ? { contractStatus: s } : {}) });
  assert.ok(act("active").ok && !act("in_review").ok && !act().ok);
  assert.ok(!evaluateTransition(obligationMachine, "active", "FULFIL", { actor: system, at: AT, outstandingIsZero: false }).ok);
  assert.ok(!evaluateTransition(obligationMachine, "proposed", "ACTIVATE", fullObligation(system)).ok, "cannot activate an unreviewed obligation");
});

test("Mandate: human approval requires approved obligations; activation requires on-chain evidence; only a human resumes", () => {
  assert.ok(evaluateTransition(mandateMachine, "proposed", "APPROVE", { actor: human, at: AT, linkedObligationsApproved: true }).ok);
  assert.ok(!evaluateTransition(mandateMachine, "proposed", "APPROVE", { actor: human, at: AT, linkedObligationsApproved: false }).ok);
  assert.ok(!evaluateTransition(mandateMachine, "proposed", "APPROVE", { actor: human, at: AT }).ok);
  assert.ok(!evaluateTransition(mandateMachine, "proposed", "ACTIVATE", fullMandate(system)).ok, "cannot skip approval");
  const noReg = evaluateTransition(mandateMachine, "approved", "ACTIVATE", { actor: system, at: AT });
  assert.ok(!noReg.ok && noReg.guardCode === "REGISTRY_EVIDENCE_REQUIRED");
  assert.ok(!evaluateTransition(mandateMachine, "approved", "ACTIVATE", fullMandate(human)).ok, "activation is a system act after registration");
  assert.ok(!evaluateTransition(mandateMachine, "suspended", "RESUME", fullMandate(system)).ok, "system cannot lift a suspension");
  assert.ok(evaluateTransition(mandateMachine, "suspended", "RESUME", fullMandate(human)).ok);
  assert.ok(!evaluateTransition(mandateMachine, "active", "SUSPEND", { actor: system, at: AT }).ok, "suspension needs a reason");
  assert.ok(evaluateTransition(mandateMachine, "active", "SUSPEND", { actor: system, at: AT, reason: "anomaly" }).ok);
  assert.ok(!evaluateTransition(mandateMachine, "active", "SUSPEND", { actor: agent, at: AT, reason: "x" }).ok, "an agent cannot suspend (or un-suspend) itself");
  for (const s of ["revoked", "expired", "exhausted", "rejected"] as const) assert.ok(!evaluateTransition(mandateMachine, s, "RESUME", fullMandate(human)).ok);
});

test("SpendIntent: lifecycle outcome must mirror the PolicyDecision; a deny can never be overridden or submitted", () => {
  const ev = (trig: Parameters<typeof evaluateTransition<string, string, SpendIntentContext>>[2], ctx: Partial<SpendIntentContext> & { actor: Actor }, from = "evaluating") =>
    evaluateTransition(spendIntentMachine as unknown as MachineDefinition<string, string, SpendIntentContext>, from, trig, { at: AT, ...ctx });
  assert.ok(ev("ALLOW", { actor: system, policyDecisionId: decisionId, policyOutcome: "allow" }).ok);
  assert.ok(ev("DENY", { actor: system, policyDecisionId: decisionId, policyOutcome: "deny" }).ok);
  assert.ok(ev("ESCALATE", { actor: system, policyDecisionId: decisionId, policyOutcome: "require_human_approval" }).ok);
  for (const [t, wrong] of [["ALLOW", "deny"], ["ALLOW", "require_human_approval"], ["DENY", "allow"], ["ESCALATE", "allow"]] as const) {
    const r = ev(t, { actor: system, policyDecisionId: decisionId, policyOutcome: wrong });
    assert.ok(!r.ok && r.guardCode === "POLICY_OUTCOME_MISMATCH", `${t} with ${wrong}`);
  }
  assert.ok(!ev("ALLOW", { actor: system, policyOutcome: "allow" }).ok, "no decision id => blocked");
  assert.ok(!ev("ALLOW", { actor: system, policyDecisionId: decisionId }).ok, "no outcome => blocked");
  assert.ok(!ev("ALLOW", { actor: agent, policyDecisionId: decisionId, policyOutcome: "allow" }).ok, "the agent cannot approve its own spend");
  assert.ok(!ev("ALLOW", { actor: ai, policyDecisionId: decisionId, policyOutcome: "allow" }).ok, "AI cannot approve spend");
  assert.ok(!ev("ALLOW", { actor: human, policyDecisionId: decisionId, policyOutcome: "allow" }).ok, "allow is the engine's act; humans use HUMAN_APPROVE on escalations");
  for (const t of ["HUMAN_APPROVE", "SUBMIT", "SETTLE", "ALLOW"] as const) assert.ok(!ev(t, fullSpend(human, "allow"), "blocked").ok, `blocked -${t}-> rejected`);
  assert.ok(!ev("HUMAN_APPROVE", fullSpend(human), "evaluating").ok, "HUMAN_APPROVE only from pending_human_approval");
  assert.ok(ev("HUMAN_APPROVE", { actor: human }, "pending_human_approval").ok);
  assert.ok(!ev("HUMAN_APPROVE", { actor: agent }, "pending_human_approval").ok);
  assert.ok(!ev("SUBMIT", { actor: system }, "approved").ok, "needs a built transaction");
  assert.ok(!ev("SUBMIT", fullSpend(system), "evaluating").ok, "cannot submit an unapproved spend");
  assert.ok(!ev("SUBMIT", fullSpend(system), "requested").ok);
  assert.ok(!ev("SUBMIT", fullSpend(system), "pending_human_approval").ok, "escalated spends cannot be submitted before human approval");
});

test("Settlement: confirmation needs a signature, reconciliation needs matching amounts and ledger entries", () => {
  const ev = (from: string, trig: "CONFIRM" | "FINALIZE" | "RECONCILE" | "FAIL", ctx: Partial<SettlementContext>) => evaluateTransition(settlementMachine, from, trig, { actor: system, at: AT, ...ctx });
  assert.ok(ev("pending", "CONFIRM", { transactionSignaturePresent: true }).ok);
  assert.ok(!ev("pending", "CONFIRM", {}).ok);
  assert.ok(!ev("pending", "RECONCILE", fullSettlement(system)).ok, "cannot skip confirmation/finality");
  assert.ok(!ev("confirmed", "RECONCILE", fullSettlement(system)).ok, "cannot skip finality");
  assert.ok(ev("finalized", "RECONCILE", { amountMatchesIntent: true, ledgerEntriesPosted: 1 }).ok);
  const mismatch = ev("finalized", "RECONCILE", { amountMatchesIntent: false, ledgerEntriesPosted: 2 });
  assert.ok(!mismatch.ok && mismatch.guardCode === "AMOUNT_MISMATCH");
  const noLedger = ev("finalized", "RECONCILE", { amountMatchesIntent: true, ledgerEntriesPosted: 0 });
  assert.ok(!noLedger.ok && noLedger.guardCode === "LEDGER_ENTRIES_REQUIRED");
  assert.ok(!ev("pending", "FAIL", {}).ok && ev("pending", "FAIL", { failureReason: "blockhash expired" }).ok);
  assert.ok(!ev("confirmed", "FAIL", { failureReason: "x" }).ok, "a confirmed settlement cannot silently fail");
  for (const a of [human, agent, ai]) assert.ok(!evaluateTransition(settlementMachine, "pending", "CONFIRM", fullSettlement(a)).ok, `${a.type} cannot confirm a settlement`);
});

/* ---------------------------------------------------------------- advance*: applying transitions to entities */

const base = <T>(arr: readonly T[], i = 0): T => clone(arr[i]!);
const unwrap = <T extends { ok: boolean }>(r: T) => r;

test("advance*: returns a new validated entity, bumps revision, sets updatedAt, never mutates the input", () => {
  const sp0: SpendIntent = { ...base(g.spendIntents, 1), status: "evaluating", policyDecisionId: null, revision: 2, updatedAt: "2026-10-05T10:00:00Z" };
  const frozen = Object.freeze({ ...sp0 });
  const r = advanceSpendIntent(frozen, "ALLOW", { actor: system, at: AT, policyDecisionId: decisionId, policyOutcome: "allow" });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.value.entity.status, "approved");
  assert.equal(r.value.entity.revision, 3);
  assert.equal(r.value.entity.updatedAt, AT);
  assert.equal(r.value.entity.policyDecisionId, decisionId);
  assert.equal(r.value.transition.emits, "SpendApproved");
  assert.equal(frozen.status, "evaluating", "input untouched");
});

test("advance*: illegal transitions come back as INVALID_TRANSITION errors with codes, never exceptions", () => {
  const c: Contract = base(g.contracts);
  const r = advanceContract(c, "BEGIN_REVIEW", fullContract(human));
  assert.ok(!r.ok);
  if (r.ok) return;
  assert.ok(r.error instanceof FluxGraphError);
  assert.equal(r.error.code, "INVALID_TRANSITION");
  assert.ok(r.error.details.includes("INVALID_TRANSITION"));
  const guard = advanceSpendIntent({ ...base(g.spendIntents, 1), status: "evaluating", policyDecisionId: null }, "ALLOW", { actor: agent, at: AT, policyDecisionId: decisionId, policyOutcome: "allow" });
  assert.ok(!guard.ok && guard.error.details.includes("GUARD_FAILED") && guard.error.details.includes("ACTOR_NOT_PERMITTED"));
});

test("advance*: time may not run backwards", () => {
  const m: Mandate = base(g.mandates);
  const r = advanceMandate(m, "SUSPEND", { actor: system, at: "2020-01-01T00:00:00Z", reason: "x" });
  assert.ok(!r.ok && r.error.code === "INVARIANT_VIOLATION");
});

test("advance*: obligation approval records the acting human as reviewer; AI approval is impossible", () => {
  const proposed: Obligation = { ...base(g.obligations), status: "proposed", review: null, revision: 1, updatedAt: base(g.obligations).createdAt };
  const approved = advanceObligation(proposed, "APPROVE", { actor: human, at: AT, citationCount: 1, note: "checked clause 4.2" });
  assert.ok(approved.ok);
  if (!approved.ok) return;
  assert.equal(approved.value.entity.review?.decision, "approved");
  assert.equal(approved.value.entity.review?.byUserId, human.id);
  assert.equal(approved.value.entity.review?.note, "checked clause 4.2");
  for (const a of [ai, agent, system]) assert.ok(!advanceObligation(proposed, "APPROVE", { actor: a, at: AT, citationCount: 1 }).ok, `${a.type} cannot approve`);
  const rejected = advanceObligation(proposed, "REJECT", { actor: human, at: AT, note: "amount conflicts with schedule" });
  assert.ok(rejected.ok && rejected.value.entity.status === "rejected" && rejected.value.entity.review?.decision === "rejected");
  assert.ok(ObligationSchema.safeParse(rejected.ok ? rejected.value.entity : null).success);
});

test("advance*: mandate approve then activate appends approval and registry; resulting entity re-validates", () => {
  const proposed: Mandate = { ...base(g.mandates), status: "proposed", approvals: [], registry: null, revision: 1, updatedAt: base(g.mandates).createdAt };
  const a1 = advanceMandate(proposed, "APPROVE", { actor: human, at: AT, linkedObligationsApproved: true });
  assert.ok(a1.ok);
  if (!a1.ok) return;
  assert.equal(a1.value.entity.approvals.length, 1);
  assert.equal(a1.value.entity.approvals[0]!.userId, human.id);
  const a2 = advanceMandate(a1.value.entity, "ACTIVATE", { actor: system, at: AT, registry });
  assert.ok(a2.ok && a2.value.entity.status === "active" && a2.value.entity.registry !== null && a2.value.entity.revision === 3);
  assert.ok(!advanceMandate(a1.value.entity, "ACTIVATE", { actor: system, at: AT }).ok);
});

test("advance*: settlement stages stamp their timestamps and failure carries a reason", () => {
  const s0: Settlement = { ...base(g.settlements), status: "pending", confirmedAt: null, finalizedAt: null, reconciledAt: null, revision: 1, updatedAt: base(g.settlements).createdAt };
  const c = advanceSettlement(s0, "CONFIRM", { actor: system, at: AT, transactionSignaturePresent: true });
  assert.ok(c.ok && c.value.entity.confirmedAt === AT);
  const f = advanceSettlement(s0, "FAIL", { actor: system, at: AT, failureReason: "blockhash expired" });
  assert.ok(f.ok && f.value.entity.failureReason === "blockhash expired" && f.value.entity.status === "failed");
  assert.ok(!advanceSettlement(s0, "FAIL", { actor: system, at: AT }).ok);
  assert.ok(unwrap(advanceSettlement(f.ok ? f.value.entity : s0, "CONFIRM", fullSettlement(system))).ok === false, "failed is terminal");
});

test("advance*: contract path uploaded → active needs every step, in order", () => {
  let c: Contract = { ...base(g.contracts), status: "uploaded", revision: 1, updatedAt: base(g.contracts).createdAt };
  const steps: [Parameters<typeof advanceContract>[1], ContractContext][] = [
    ["START_EXTRACTION", { actor: system, at: AT }],
    ["EXTRACTION_SUCCEEDED", { actor: system, at: AT, extractedTermsPresent: true }],
    ["BEGIN_REVIEW", { actor: human, at: AT }],
    ["APPROVE", { actor: human, at: AT, materialObligationCount: 4, unapprovedMaterialObligationCount: 0 }],
  ];
  for (const [t, ctx] of steps) {
    const r = advanceContract(c, t, ctx);
    assert.ok(r.ok, t);
    if (r.ok) c = r.value.entity;
  }
  assert.equal(c.status, "active");
  assert.equal(c.revision, 5);
});
