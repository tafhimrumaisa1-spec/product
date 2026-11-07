# ASSUMPTIONS.md

Each assumption is something the build could not confirm from primary sources or run. Each is isolated behind a small interface so it can be corrected at integration without touching the executor.

## Unverified API details (primary docs silent or unreachable)

1. **`sendTransaction()` return value.** Docs show `.sendTransaction()` chaining but not what it resolves to. The adapter accepts a string or `{ signature, lastValidBlockHeight? }` and throws `ADAPTER_CONTRACT` otherwise. Override with `extractSubmitted`. *If the real client resolves to something else, creation/pull will fail loudly rather than silently.*
2. **Single delegation account fetch.** Docs list `fetchDelegationsByDelegator/Delegatee` but no single-account fetch. State reading is injected via `DelegationAccountReaders`, using the on-chain field names from ADR-001.
3. **Program error names.** Only `StaleSubscriptionAuthority` is named. Unclassified failures before submission become `PROGRAM_REJECTED`; abort/timeout becomes `RPC_TIMEOUT`. FluxFlow does not string-match program errors.
4. **Package versions.** `@solana/kit`, `@solana/subscriptions`, kit plugins and `@solana-program/token` are peer dependencies with `*` ranges because npm was not reachable. x402 doc examples show `@solana/kit@^6.9.0`; non-primary sources claim 8.x. Pin at install against `@solana/subscriptions`' own peer range.
5. **Kit type compatibility.** Adapter/reader types are structural (method-style, bivariant) and were **not** compiled against the real Kit/Subscriptions types (not installable offline). Expect small type-level adjustments (e.g. Kit's branded `Address`) at integration.
6. **Token-balance evidence fields.** The chain reader reads `meta.preTokenBalances/postTokenBalances` (`accountIndex`, `mint`, `owner`, `uiTokenAmount.amount`) via `getTransaction` with `jsonParsed`. These are standard JSON-RPC fields but their pages were not fetched this session.
7. **Remaining-allowance formula.** Computed client-side from ADR-001 fields; the docs do not state the exact period-reset boundary. It is a pre-flight guard only. If the program disagrees, the program wins and the pull fails as `PROGRAM_REJECTED`.
8. **Expiry boundary.** `computeRemaining` treats `now >= expiryTs` as expired (conservative). The docs say transfers fail once `expiryTs` passes.
9. **Node version.** Developed and tested on Node v22.23.4. `engines: ">=20"` is a conservative guess, not a documented requirement.

## Design assumptions

10. **FluxMandate provides `MandateRegistryClient`.** FluxFlow only defines the consumer interface and a mock. The field set of `MandateRecord` is FluxFlow's proposal and must be reconciled with FluxMandate.
11. **`humanApprovalRef` is opaque.** FluxFlow requires it to be non-empty but cannot verify its authenticity; the registry/FluxMandate is the source of truth for human approval.
12. **Receipt identifiers are off-chain.** `contractId`, `obligationId`, etc. in `SettlementReceipt` are internal identifiers. FluxFlow writes nothing on-chain beyond the token transfer itself (no memo). FluxProof must not publish these on-chain unsalted.
13. **`delegator` token account exists** (documented precondition for Subscription Authority initialization) and the **recipient's associated token account exists** (the adapter derives it but does not create it).
14. **Token programs.** The adapter passes `TOKEN_PROGRAM_ADDRESS` (SPL Token). Token-2022 mints are supported by the program per its docs, but transfer-fee/hook mints are not supported by FluxFlow: exact-amount verification would flag a fee as `SETTLEMENT_MISMATCH`.
15. **`local` network cannot be fingerprinted.** An unknown genesis hash is reported as `local`; the Kit reader rejects only the Mainnet reference. Pointing a `local` config at a non-Mainnet public cluster other than Devnet would not be detected.
16. **Receipts for `RPC_TIMEOUT` are not auto-resolved.** The idempotency key stays reserved with its signature (when known). A reconciliation routine (FluxLedger or a follow-up) must resolve it; FluxFlow does not implement `resume`.
17. **In-memory `ReceiptStore`.** Single-process only. Production needs an atomic durable store (unique-key inserts).
18. **Single payment per execute.** No batching, no sponsor fee payer, no subscription plans, no address lookup tables.
