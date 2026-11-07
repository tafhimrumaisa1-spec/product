import type { ObligationStatus, ContractStatus } from "../statuses";
import { all, requireActor, requireFact, requireHuman, fail, pass } from "./guards";
import { defineMachine, type BaseContext } from "./machine";

export const OBLIGATION_TRIGGERS = ["APPROVE", "REJECT", "ACTIVATE", "FULFIL", "CANCEL", "EXPIRE"] as const;
export type ObligationTrigger = (typeof OBLIGATION_TRIGGERS)[number];

export interface ObligationContext extends BaseContext {
  readonly note?: string;
  readonly citationCount?: number;
  readonly contractStatus?: ContractStatus;
  readonly outstandingIsZero?: boolean;
}

const system = (c: ObligationContext) => requireActor(c, ["system"]);

export const obligationMachine = defineMachine<ObligationStatus, ObligationTrigger, ObligationContext>({
  name: "Obligation",
  initial: "proposed",
  states: ["proposed", "approved", "rejected", "active", "fulfilled", "cancelled", "expired"],
  terminal: ["rejected", "fulfilled", "cancelled", "expired"],
  transitions: {
    proposed: {
      APPROVE: {
        to: "approved", description: "Human approves an AI-proposed obligation", emits: "ObligationApproved",
        guard: (c) => all(
          requireHuman(c),
          c.citationCount !== undefined && c.citationCount >= 1 ? pass : fail("EVIDENCE_CITATION_REQUIRED", "approval requires at least one evidence citation"),
        ),
      },
      REJECT: {
        to: "rejected", description: "Human rejects", emits: "ObligationRejected",
        guard: (c) => all(requireHuman(c), c.note && c.note.trim() ? pass : fail("REASON_REQUIRED", "rejection requires a reason")),
      },
    },
    approved: {
      ACTIVATE: {
        to: "active", description: "Contract became active", emits: null,
        guard: (c) => all(system(c), requireFact(c.contractStatus === "active", "CONTRACT_NOT_ACTIVE", "contract must be active")),
      },
      CANCEL: { to: "cancelled", description: "Human cancels before activation", guard: requireHuman, emits: null },
    },
    active: {
      FULFIL: {
        to: "fulfilled", description: "Nothing outstanding", emits: null,
        guard: (c) => all(system(c), requireFact(c.outstandingIsZero, "OBLIGATION_NOT_SETTLED", "obligation still has an outstanding amount")),
      },
      CANCEL: { to: "cancelled", description: "Human cancels", guard: requireHuman, emits: null },
      EXPIRE: { to: "expired", description: "Term ended", guard: system, emits: null },
    },
    rejected: {},
    fulfilled: {},
    cancelled: {},
    expired: {},
  },
});
