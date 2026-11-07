import type { ContractStatus } from "../statuses";
import { all, pass, requireActor, requireFact, requireHuman, fail } from "./guards";
import { defineMachine, type BaseContext } from "./machine";

export const CONTRACT_TRIGGERS = [
  "START_EXTRACTION", "EXTRACTION_SUCCEEDED", "EXTRACTION_FAILED", "RETRY_EXTRACTION",
  "BEGIN_REVIEW", "RETURN_FOR_REEXTRACTION", "APPROVE", "REJECT", "EXPIRE", "TERMINATE",
] as const;
export type ContractTrigger = (typeof CONTRACT_TRIGGERS)[number];

export interface ContractContext extends BaseContext {
  readonly extractedTermsPresent?: boolean;
  readonly materialObligationCount?: number;
  readonly unapprovedMaterialObligationCount?: number;
}

const system = (ctx: ContractContext) => requireActor(ctx, ["system"]);

export const contractMachine = defineMachine<ContractStatus, ContractTrigger, ContractContext>({
  name: "Contract",
  initial: "uploaded",
  states: ["uploaded", "extracting", "extraction_failed", "extracted", "in_review", "active", "rejected", "expired", "terminated"],
  terminal: ["rejected", "expired", "terminated"],
  transitions: {
    uploaded: {
      START_EXTRACTION: { to: "extracting", description: "Extraction job started", guard: system, emits: null },
    },
    extracting: {
      EXTRACTION_SUCCEEDED: {
        to: "extracted", description: "Terms and citations extracted", emits: "TermsExtracted",
        guard: (c) => all(system(c), requireFact(c.extractedTermsPresent, "EXTRACTION_RESULT_MISSING", "extracted terms must be attached")),
      },
      EXTRACTION_FAILED: { to: "extraction_failed", description: "Extraction failed", guard: system, emits: "ExtractionFailed" },
    },
    extraction_failed: {
      RETRY_EXTRACTION: { to: "extracting", description: "Retry extraction", guard: system, emits: null },
      REJECT: { to: "rejected", description: "Human abandons the contract", guard: requireHuman, emits: null },
    },
    extracted: {
      BEGIN_REVIEW: { to: "in_review", description: "Human opens review", guard: requireHuman, emits: null },
    },
    in_review: {
      APPROVE: {
        to: "active", description: "Human approves; every material obligation already approved", emits: "ContractActivated",
        guard: (c) => {
          const human = requireHuman(c);
          if (!human.ok) return human;
          if (c.materialObligationCount === undefined || c.unapprovedMaterialObligationCount === undefined) {
            return fail("MATERIAL_OBLIGATIONS_UNAPPROVED", "obligation counts must be supplied");
          }
          if (c.materialObligationCount < 1) return fail("NO_MATERIAL_OBLIGATIONS", "a contract needs at least one approved material obligation");
          return c.unapprovedMaterialObligationCount === 0
            ? pass
            : fail("MATERIAL_OBLIGATIONS_UNAPPROVED", `${c.unapprovedMaterialObligationCount} material obligation(s) still await human approval`);
        },
      },
      REJECT: { to: "rejected", description: "Human rejects", guard: requireHuman, emits: null },
      RETURN_FOR_REEXTRACTION: { to: "extracting", description: "Human sends back for re-extraction", guard: requireHuman, emits: null },
    },
    active: {
      EXPIRE: { to: "expired", description: "Term ended", guard: system, emits: null },
      TERMINATE: { to: "terminated", description: "Human terminates", guard: requireHuman, emits: null },
    },
    rejected: {},
    expired: {},
    terminated: {},
  },
});
