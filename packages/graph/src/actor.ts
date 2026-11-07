import { z } from "zod";
import { IdSchemas, type AgentId, type UserId } from "./ids";
import { Slug } from "./primitives";

/**
 * Who caused something. The four actor types are the backbone of the product's trust model:
 *  human    - approves obligations and mandates
 *  agent    - may only request spends
 *  ai_model - interprets and explains (extraction, proposals); never approves
 *  system   - deterministic code (policy engine, twin, flow, ledger)
 */
export const ActorSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("human"), id: IdSchemas.user }).strict(),
  z.object({ type: z.literal("agent"), id: IdSchemas.agent }).strict(),
  z.object({ type: z.literal("ai_model"), id: z.string().regex(/^[a-z0-9][a-z0-9._:\/-]{2,80}$/) }).strict(),
  z.object({ type: z.literal("system"), id: Slug }).strict(),
]);
export type Actor = z.infer<typeof ActorSchema>;
export type ActorType = Actor["type"];

export const humanActor = (id: UserId): Actor => ({ type: "human", id });
export const agentActor = (id: AgentId): Actor => ({ type: "agent", id });
export const aiModelActor = (id: string): Actor => ActorSchema.parse({ type: "ai_model", id });
export const systemActor = (id: string): Actor => ActorSchema.parse({ type: "system", id });
