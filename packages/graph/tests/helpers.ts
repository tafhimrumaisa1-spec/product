import { agentActor, aiModelActor, humanActor, parseId, systemActor, type Actor } from "../src/index";
import { FIXTURE } from "../src/index";

export const maya = parseId("user", FIXTURE.ids["maya"]);
export const agentId = parseId("agent", FIXTURE.ids["agent"]);
export const human: Actor = humanActor(maya);
export const agent: Actor = agentActor(agentId);
export const ai: Actor = aiModelActor("fluxcontracts/synthetic-extractor-1");
export const system: Actor = systemActor("fluxflow");
export const ACTORS: readonly Actor[] = [human, agent, ai, system];
export const AT = "2026-10-06T00:00:00Z";
export const clone = <T>(v: T): T => structuredClone(v);
