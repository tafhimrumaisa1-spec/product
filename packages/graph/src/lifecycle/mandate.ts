import type { MandateRegistry } from "../entities";
import type { MandateStatus } from "../statuses";
import { all, requireActor, requireFact, requireHuman, fail, pass } from "./guards";
import { defineMachine, type BaseContext } from "./machine";

export const MANDATE_TRIGGERS = ["APPROVE", "REJECT", "ACTIVATE", "SUSPEND", "RESUME", "REVOKE", "EXPIRE", "EXHAUST"] as const;
export type MandateTrigger = (typeof MANDATE_TRIGGERS)[number];

export interface MandateContext extends BaseContext {
  readonly linkedObligationsApproved?: boolean;
  readonly registry?: MandateRegistry;
  readonly reason?: string;
}

const system = (c: MandateContext) => requireActor(c, ["system"]);

export const mandateMachine = defineMachine<MandateStatus, MandateTrigger, MandateContext>({
  name: "Mandate",
  initial: "proposed",
  states: ["proposed", "approved", "active", "suspended", "rejected", "revoked", "expired", "exhausted"],
  terminal: ["rejected", "revoked", "expired", "exhausted"],
  transitions: {
    proposed: {
      APPROVE: {
        to: "approved", description: "Human approves the proposed authority", emits: "MandateApproved",
        guard: (c) => all(
          requireHuman(c),
          requireFact(c.linkedObligationsApproved, "OBLIGATIONS_NOT_APPROVED", "every linked obligation must already be human-approved"),
        ),
      },
      REJECT: { to: "rejected", description: "Human rejects", guard: requireHuman, emits: null },
    },
    approved: {
      ACTIVATE: {
        to: "active", description: "Authority registered on-chain", emits: "MandateActivated",
        guard: (c) => all(system(c), c.registry ? pass : fail("REGISTRY_EVIDENCE_REQUIRED", "on-chain registry evidence is required to activate")),
      },
      REVOKE: { to: "revoked", description: "Human revokes before activation", guard: requireHuman, emits: "MandateRevoked" },
      EXPIRE: { to: "expired", description: "Validity window passed", guard: system, emits: null },
    },
    active: {
      SUSPEND: {
        to: "suspended", description: "Safety pause (system or human)", emits: "MandateSuspended",
        guard: (c) => all(requireActor(c, ["system", "human"]), c.reason?.trim() ? pass : fail("REASON_REQUIRED", "suspension requires a reason")),
      },
      REVOKE: { to: "revoked", description: "Human revokes", guard: requireHuman, emits: "MandateRevoked" },
      EXPIRE: { to: "expired", description: "Validity window passed", guard: system, emits: null },
      EXHAUST: { to: "exhausted", description: "Total limit consumed", guard: system, emits: null },
    },
    suspended: {
      RESUME: { to: "active", description: "Only a human may lift a suspension", guard: requireHuman, emits: null },
      REVOKE: { to: "revoked", description: "Human revokes", guard: requireHuman, emits: "MandateRevoked" },
      EXPIRE: { to: "expired", description: "Validity window passed", guard: system, emits: null },
    },
    rejected: {},
    revoked: {},
    expired: {},
    exhausted: {},
  },
});
