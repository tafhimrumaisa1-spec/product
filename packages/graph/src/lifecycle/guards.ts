import type { ActorType } from "../actor";
import type { BaseContext, GuardCode, GuardResult } from "./machine";

export const pass: GuardResult = { ok: true };
export const fail = (code: GuardCode, message: string): GuardResult => ({ ok: false, code, message });

/** First failure wins; all-pass => pass. */
export const all = (...results: GuardResult[]): GuardResult => results.find((r) => !r.ok) ?? pass;

export const requireActor = (ctx: BaseContext, allowed: readonly ActorType[]): GuardResult =>
  allowed.includes(ctx.actor.type) ? pass : fail("ACTOR_NOT_PERMITTED", `actor type "${ctx.actor.type}" may not perform this action (allowed: ${allowed.join(", ")})`);

/** Approvals are a human-only act. AI models, agents and system code are all rejected. */
export const requireHuman = (ctx: BaseContext): GuardResult =>
  ctx.actor.type === "human" ? pass : fail("HUMAN_APPROVAL_REQUIRED", `requires a human actor, got "${ctx.actor.type}"`);

/** Fail closed: a missing fact (undefined) is treated the same as false. */
export const requireFact = (condition: boolean | undefined, code: GuardCode, message: string): GuardResult =>
  condition === true ? pass : fail(code, message);
