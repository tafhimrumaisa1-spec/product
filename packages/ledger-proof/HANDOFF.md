# HANDOFF — Agent 07: FluxLedger + FluxProof

## 1. What was built

A TypeScript (strict) library, `@fluxmandate/ledger-proof`, ~2,600 lines including tests:

- **Event model & append-only store interfaces** (`events.ts`, `store.ts`) with a tamper-evident SHA-256 hash chain.
- **FluxLedger** (`ledger.ts`): `LedgerProjection` (pure fold over events), `rebuildLedger`, `LedgerConsumer` (cursor-based, idempotent).
- **Reference policy evaluator** (`policy.ts`) and **reason catalogue** (`reasons.ts`).
- **FluxProof** (`proof.ts`): `buildProofTrace`, `renderTraceText`.
- **Privacy** (`redaction.ts`), **explorer links** (`explorer.ts`), **money helpers** (`money.ts`), **pure SHA-256 / canonical JSON** (`sha256.ts`, `canonical.ts`).
- **Fixtures** (`fixtures.ts`): successful payment, over-limit rejection, revoked mandate, mismatched vendor.

## 2. Public interfaces (everything is exported from `source/index.ts`)

### Producing events (FluxContracts, FluxTwin, FluxMandate, FluxFlow)
```ts
interface EventStore extends EventReader {
  append(input: AuditEventInput): Promise<AppendResult>;   // { event, duplicate }
  head(): Promise<{ sequence: number; hash: string }>;
}
interface EventReader { readFrom(afterSequence: number, limit?: number): Promise<readonly AuditEvent[]> }
```
`AuditEventInput` is a discriminated union on `type`; every event has `eventId` (idempotency key, `[A-Za-z0-9._:-]{1,128}`), `occurredAt` (ISO-8601, producer-supplied),
`schemaVersion: 1`, optional `source`, and a typed `payload`. Money is a **decimal string of minor units** (USDC = 6 decimals): `"1000000000"` = 1,000 USDC.

| Event type | Suggested producer | Ledger effect |
|---|---|---|
| `ContractRegistered`, `ContractVersionRecorded`, `EvidenceClauseLinked` | FluxContracts | audit only (FluxProof) |
| `ObligationApproved` (`approvedBy` must be `human:…`) | FluxContracts | creates obligation |
| `TwinScenarioRecorded` | FluxTwin | audit only (FluxProof) |
| `MandateCreated` (`approvedBy` must be `human:…`), `MandateRevoked`, `DelegationGranted` (`grantedBy` human) | FluxMandate | authority state |
| `SpendIntentSubmitted` | FluxFlow | records intent |
| `PolicyDecisionRecorded` (`reasonCodes`, `reasonParams`) | FluxMandate / FluxFlow (what the program decided) | approve → reserves allowance; reject → none |
| `TransactionSubmitted`, `SettlementConfirmed`, `SettlementFailed` | FluxFlow | settle → books spend; fail → releases reservation |
| `TaskRevenueRecorded` | FluxFlow / app | task revenue |

### Consuming (FluxShell, API routes)
```ts
const consumer = new LedgerConsumer(reader);  await consumer.catchUp();
const p = consumer.projection;                // LedgerProjection
p.agentSpend()            p.vendorExpense()        p.contractObligations()   p.settlements()
p.taskEconomics()         p.mandateAllowance(id, asOfIso?)   p.mandateAllowances(asOfIso?)
p.intentViews()           p.ledgerEntries()        p.anomalies()             p.snapshot(asOfIso?)
rebuildLedger(events)     // from scratch
p.evaluateIntent(intent, nowIso)   // PolicyEvaluation { decision, reasonCodes, reasonParams, reasons[], headline }
```
All views are JSON-safe (no bigint).

### Evidence
```ts
buildProofTrace(events, { intentId } | { settlementId }, { privacy?: 'internal'|'auditor'|'public', explorer?: { localnetRpcUrl?, baseUrl? } }): ProofTrace
// ProofTrace { steps[12], outcome, headline, complete, gaps[], anomalies[], integrity }
// Each step: { kind, status: 'present'|'missing'|'not_applicable', entries[{ refId, eventId, sequence, summary, details, explorerUrl? }], reasonCodes?, reasons? }
```
Render the structured trace in FluxShell; put `explorerUrl`s and raw hashes in the expandable proof drawer.

### Helpers
`describeReason`, `explainDecision`, `ReasonCodes`, `redactEvent`, `redactValue`, `createSaltedCommitment`, `verifyCommitment`, `generateSalt`, `maskIdentifier`,
`findSecretFields`, `buildExplorerUrl` / `explorerTxUrl` / `explorerAddressUrl`, `verifyEventChain`, `formatAmount`, `toMinor`, `buildFixture(name, store?)`.

## 3. How to run it
`npm install --no-package-lock && npm test` (see README). Build output goes to `.build/` (git-ignored).

## 4. Dependencies required
- Runtime (`source/`): **none**.
- Dev: `typescript`, `@types/node` (for tests). Tests need Node ≥ 22.
- Do **not** commit a lockfile from this package (collaboration rule); the integrator owns the root lockfile.

## 5. Tests performed
60 unit tests, all passing in the delivery environment — see `TEST_REPORT.md` (exact commands, versions, per-file counts and what was *not* verified).

## 6. Known limitations
1. **Reference policy ≠ enforcement.** `evaluateSpendIntent` mirrors the rules for explanation/fixtures. The authoritative decision is whatever the Solana program decided, recorded in `PolicyDecisionRecorded`. The ledger does not (yet) flag a recorded approval that its own evaluation would reject.
2. **No on-chain verification.** `SettlementConfirmed` is trusted as produced by FluxFlow. Fixture signatures/addresses are synthetic base58 strings; their explorer links will not resolve.
3. **Single currency per ledger** (`LedgerConfig.currency`, default `USDC`); other currencies are quarantined as `UNSUPPORTED_CURRENCY`.
4. **In-memory only.** Projections are O(n) in places (e.g. pending reservation sums, `buildProofTrace` rebuilds the projection per call). Fine for the demo; add indexes/caching for scale.
5. **Payload validation is minimal at the store** (envelope, secret-looking keys, JSON-safety). Type-specific validation happens in the projection and turns bad payloads into `INVALID_PAYLOAD` anomalies rather than exceptions. `evaluateIntent` throws `MoneyError` for a malformed amount string.
6. **Period cap** uses fixed windows anchored at the mandate `startsAt` (rolling windows are not implemented); pending approvals count toward the period cap conservatively.
7. An approved intent whose mandate is revoked *afterwards* can still settle (the approval pre-dated the revocation). Whether the chain allows that is FluxMandate's call.
8. `excerptPreview` (optional) lets an internal audit log carry short clause text. Producers who ship logs outside the organisation should omit it; `public`/`auditor` redaction strips it.
9. `periodDays`, runway figures etc. are plain numbers; money never is.

## 7. Integration requirements
- **Event IDs must be deterministic per real-world fact** (e.g. `settle:<cluster>:<signature>`) so retries are naturally idempotent.
- **Actor naming:** humans `human:<id>`; AI agents `agent:<id>`. Approvals by anything else are quarantined (`NON_HUMAN_APPROVER`).
- **Decision params:** FluxMandate/FluxFlow should store the raw parameters used (see keys in `reasons.ts`: `amountMinor`, `perPaymentLimitMinor`, `periodCapMinor`, `periodProjectedMinor`, `remainingMinor`, `mandateVendorId`, `intentVendorId`, …) so FluxProof can render explanations.
- **Mandate → obligation link:** `MandateCreated.obligationId` must reference an approved obligation of the same vendor/contract and `limitMinor ≤ totalMinor`.
- **Twin link:** set `MandateCreated.twinScenarioId`, or include the obligation in `TwinScenarioRecorded.obligationIds`.
- **Settlement order:** `SpendIntentSubmitted` → `PolicyDecisionRecorded(approved)` → `TransactionSubmitted` → `SettlementConfirmed`; feed events in store order.
- **Persistence:** implement `EventStore` over the chosen DB with a unique constraint on `eventId`, a gap-free sequence and the same `computeEventHash`. Keep `verifyEventChain` as a periodic job.
- **Never** put keypairs, seeds, API keys or contract text into payloads; the store rejects secret-looking field names.
- **Privacy:** use `privacy: 'public'` traces for anything shown outside the organisation.
