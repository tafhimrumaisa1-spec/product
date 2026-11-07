import type { PolicyOutcome } from "../policy";
import type { PolicyDecisionId } from "../ids";
import type { SpendIntentStatus } from "../statuses";
import { all, requireActor, requireFact, requireHuman, fail, pass } from "./guards";
import { defineMachine, type BaseContext, type GuardResult } from "./machine";

export const SPEND_INTENT_TRIGGERS = [
  "BEGIN_EVALUATION", "ALLOW", "DENY", "ESCALATE", "HUMAN_APPROVE", "HUMAN_DENY", "SUBMIT", "SETTLE", "FAIL", "CANCEL", "EXPIRE",
] as const;
export type SpendIntentTrigger = (typeof SPEND_INTENT_TRIGGERS)[number];

export interface SpendIntentContext extends BaseContext {
  readonly policyDecisionId?: PolicyDecisionId;
  readonly policyOutcome?: PolicyOutcome;
  readonly hasTransaction?: boolean;
}

const system = (c: SpendIntentContext) => requireActor(c, ["system"]);

/** The lifecycle outcome must mirror the deterministic PolicyDecision exactly. */
const outcomeGuard = (expected: PolicyOutcome) => (c: SpendIntentContext): GuardResult => all(
  system(c),
  c.policyDecisionId ? pass : fail("POLICY_DECISION_REQUIRED", "a PolicyDecision id is required"),
  c.policyOutcome === expected ? pass : fail("POLICY_OUTCOME_MISMATCH", `policy outcome must be "${expected}", got "${c.policyOutcome ?? "none"}"`),
);

export const spendIntentMachine = defineMachine<SpendIntentStatus, SpendIntentTrigger, SpendIntentContext>({
  name: "SpendIntent",
  initial: "requested",
  states: ["requested", "evaluating", "pending_human_approval", "approved", "blocked", "submitted", "settled", "failed", "cancelled", "expired"],
  terminal: ["blocked", "settled", "failed", "cancelled", "expired"],
  transitions: {
    requested: {
      BEGIN_EVALUATION: { to: "evaluating", description: "Policy engine picks up the intent", guard: system, emits: null },
      CANCEL: { to: "cancelled", description: "Requester withdraws", emits: null },
    },
    evaluating: {
      ALLOW: { to: "approved", description: "Policy allows", guard: outcomeGuard("allow"), emits: "SpendApproved" },
      DENY: { to: "blocked", description: "Policy denies (hard block, not overridable)", guard: outcomeGuard("deny"), emits: "SpendBlocked" },
      ESCALATE: { to: "pending_human_approval", description: "Policy requires a human", guard: outcomeGuard("require_human_approval"), emits: "SpendEscalated" },
    },
    pending_human_approval: {
      HUMAN_APPROVE: { to: "approved", description: "Human approves an escalated spend", guard: requireHuman, emits: "SpendApproved" },
      HUMAN_DENY: { to: "blocked", description: "Human denies", guard: requireHuman, emits: "SpendBlocked" },
      EXPIRE: { to: "expired", description: "Approval window passed", guard: system, emits: null },
    },
    approved: {
      SUBMIT: {
        to: "submitted", description: "Transaction submitted to Solana", emits: "SpendSubmitted",
        guard: (c) => all(system(c), requireFact(c.hasTransaction, "TRANSACTION_REQUIRED", "a built transaction is required")),
      },
      CANCEL: { to: "cancelled", description: "Cancelled before submission", guard: (c) => requireActor(c, ["human", "system"]), emits: null },
      EXPIRE: { to: "expired", description: "Approval window passed", guard: system, emits: null },
    },
    submitted: {
      SETTLE: { to: "settled", description: "Settlement confirmed", guard: system, emits: null },
      FAIL: { to: "failed", description: "Transaction failed", guard: system, emits: null },
    },
    blocked: {},
    settled: {},
    failed: {},
    cancelled: {},
    expired: {},
  },
});
