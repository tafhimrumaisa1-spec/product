import type { z } from "zod";
import {
  ContractSchema, MandateSchema, ObligationSchema, SettlementSchema, SpendIntentSchema,
  type Contract, type Mandate, type Obligation, type Settlement, type SpendIntent,
} from "../entities";
import { FluxGraphError } from "../errors";
import type { UserId } from "../ids";
import { err, ok, type Result } from "../result";
import { contractMachine, type ContractContext, type ContractTrigger } from "./contract";
import { evaluateTransition, type BaseContext, type MachineDefinition, type TransitionOutcome } from "./machine";
import { mandateMachine, type MandateContext, type MandateTrigger } from "./mandate";
import { obligationMachine, type ObligationContext, type ObligationTrigger } from "./obligation";
import { settlementMachine, type SettlementContext, type SettlementTrigger } from "./settlement";
import { spendIntentMachine, type SpendIntentContext, type SpendIntentTrigger } from "./spendIntent";

export interface Advanced<E, S extends string, T extends string> {
  /** The new, schema-validated entity (the input is never mutated). */
  readonly entity: E;
  readonly transition: Extract<TransitionOutcome<S, T>, { ok: true }>;
}

type Stateful<S extends string> = { readonly status: S; readonly revision: number; readonly updatedAt: string };

/**
 * Generic: guard-check, apply patch, bump revision/updatedAt, then re-validate the whole entity
 * against its schema so cross-field invariants (e.g. "active mandate has registry evidence") cannot be bypassed.
 */
function advanceEntity<E extends Stateful<S>, S extends string, T extends string, C extends BaseContext>(
  machine: MachineDefinition<S, T, C>,
  schema: z.ZodType<E, z.ZodTypeDef, unknown>,
  entity: E,
  trigger: T,
  ctx: C,
  patch?: (e: E, c: C) => Partial<E>,
): Result<Advanced<E, S, T>> {
  const outcome = evaluateTransition(machine, entity.status, trigger, ctx);
  if (!outcome.ok) {
    return err(new FluxGraphError("INVALID_TRANSITION", outcome.message, [outcome.code, ...(outcome.guardCode ? [outcome.guardCode] : [])]));
  }
  if (ctx.at < entity.updatedAt) {
    return err(new FluxGraphError("INVARIANT_VIOLATION", `Transition time ${ctx.at} precedes entity updatedAt ${entity.updatedAt}`));
  }
  const candidate = { ...entity, ...(patch ? patch(entity, ctx) : {}), status: outcome.to, revision: entity.revision + 1, updatedAt: ctx.at };
  const parsed = schema.safeParse(candidate);
  if (!parsed.success) {
    return err(new FluxGraphError("INVARIANT_VIOLATION", `${machine.name}: resulting entity violates schema invariants`, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)));
  }
  return ok({ entity: parsed.data, transition: outcome });
}

const humanId = (ctx: BaseContext): UserId => {
  if (ctx.actor.type !== "human") throw new FluxGraphError("INVARIANT_VIOLATION", "human actor expected (guard should have rejected this)");
  return ctx.actor.id;
};

export const advanceContract = (e: Contract, t: ContractTrigger, ctx: ContractContext) =>
  advanceEntity(contractMachine, ContractSchema, e, t, ctx);

export const advanceObligation = (e: Obligation, t: ObligationTrigger, ctx: ObligationContext) =>
  advanceEntity(obligationMachine, ObligationSchema, e, t, ctx, (_o, c) => {
    if (t === "APPROVE") return { review: { decision: "approved" as const, byUserId: humanId(c), at: c.at, note: c.note ?? null } };
    if (t === "REJECT") return { review: { decision: "rejected" as const, byUserId: humanId(c), at: c.at, note: c.note ?? null } };
    return {};
  });

export const advanceMandate = (e: Mandate, t: MandateTrigger, ctx: MandateContext) =>
  advanceEntity(mandateMachine, MandateSchema, e, t, ctx, (m, c) => {
    if (t === "APPROVE") return { approvals: [...m.approvals, { userId: humanId(c), at: c.at }] };
    if (t === "ACTIVATE" && c.registry) return { registry: c.registry };
    return {};
  });

export const advanceSpendIntent = (e: SpendIntent, t: SpendIntentTrigger, ctx: SpendIntentContext) =>
  advanceEntity(spendIntentMachine, SpendIntentSchema, e, t, ctx, (_s, c) =>
    (t === "ALLOW" || t === "DENY" || t === "ESCALATE") && c.policyDecisionId ? { policyDecisionId: c.policyDecisionId } : {});

export const advanceSettlement = (e: Settlement, t: SettlementTrigger, ctx: SettlementContext) =>
  advanceEntity(settlementMachine, SettlementSchema, e, t, ctx, (_s, c) => {
    if (t === "CONFIRM") return { confirmedAt: c.at };
    if (t === "FINALIZE") return { finalizedAt: c.at };
    if (t === "RECONCILE") return { reconciledAt: c.at };
    if (t === "FAIL") return { failureReason: c.failureReason ?? null };
    return {};
  });
