import type { SettlementStatus } from "../statuses";
import { all, requireActor, requireFact, fail, pass } from "./guards";
import { defineMachine, type BaseContext } from "./machine";

export const SETTLEMENT_TRIGGERS = ["CONFIRM", "FINALIZE", "RECONCILE", "FAIL"] as const;
export type SettlementTrigger = (typeof SETTLEMENT_TRIGGERS)[number];

export interface SettlementContext extends BaseContext {
  readonly transactionSignaturePresent?: boolean;
  readonly amountMatchesIntent?: boolean;
  readonly ledgerEntriesPosted?: number;
  readonly failureReason?: string;
}

const system = (c: SettlementContext) => requireActor(c, ["system"]);

export const settlementMachine = defineMachine<SettlementStatus, SettlementTrigger, SettlementContext>({
  name: "Settlement",
  initial: "pending",
  states: ["pending", "confirmed", "finalized", "reconciled", "failed"],
  terminal: ["reconciled", "failed"],
  transitions: {
    pending: {
      CONFIRM: {
        to: "confirmed", description: "Chain confirmed the transaction", emits: "SettlementConfirmed",
        guard: (c) => all(system(c), requireFact(c.transactionSignaturePresent, "TRANSACTION_SIGNATURE_REQUIRED", "a transaction signature is required")),
      },
      FAIL: {
        to: "failed", description: "Transaction failed or expired", emits: "SettlementFailed",
        guard: (c) => all(system(c), c.failureReason?.trim() ? pass : fail("REASON_REQUIRED", "a failure reason is required")),
      },
    },
    confirmed: {
      FINALIZE: { to: "finalized", description: "Finality reached", guard: system, emits: null },
    },
    finalized: {
      RECONCILE: {
        to: "reconciled", description: "Ledger entries posted and amounts match", emits: "SettlementReconciled",
        guard: (c) => all(
          system(c),
          requireFact(c.amountMatchesIntent, "AMOUNT_MISMATCH", "settled amount must equal the approved spend amount"),
          c.ledgerEntriesPosted !== undefined && c.ledgerEntriesPosted >= 1 ? pass : fail("LEDGER_ENTRIES_REQUIRED", "at least one ledger entry must be posted"),
        ),
      },
    },
    reconciled: {},
    failed: {},
  },
});
