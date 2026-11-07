# Agent 07 — FluxLedger + FluxProof

Framework-independent TypeScript package for the **FluxMandate** project. It turns an append-only stream of audit events into
(1) machine-accounting projections (**FluxLedger**) and (2) an explainable evidence trace from contract to ledger entry (**FluxProof**).

> AI interprets and explains. Humans approve. Deterministic code calculates. Solana enforces.
> This package is the *deterministic bookkeeping and evidence* layer. It never signs, never holds keys, never calls a network and never enforces spending authority.

## Implemented (in this package, tested)

| Area | What exists |
|---|---|
| Audit log | `AuditEvent` model (14 event types), `EventStore` / `EventReader` interfaces (append-only, no update/delete), `InMemoryEventStore` test store, SHA-256 hash chain, `verifyEventChain` |
| Idempotency | Store: same `eventId` + same content = no-op; same `eventId` + different content = error. Projection: `apply()` is a no-op for an already-applied `eventId`. `LedgerConsumer` resumes from a cursor |
| FluxLedger projections | agent spend · vendor expense · contract obligation · settlement · task cost · task revenue · task margin · remaining mandate allowance (+ period-cap remainder, pending reservations, intents, double-entry-style ledger entries) |
| Duplicate-settlement protection | Duplicate `settlementId`, duplicate `cluster:signature`, second settlement for the same intent, settlement without an approving decision, amount / vendor / signature mismatch → **quarantined** (never booked) and recorded as anomalies |
| Rebuild | `rebuildLedger(events)` reproduces the exact same snapshot as incremental consumption |
| Reasons | 29 machine-readable `ReasonCode`s with deterministic human-readable text (`describeReason`, `explainDecision`) |
| FluxProof | `buildProofTrace` → 12-step trace: Contract → Contract version → Evidence clause → Approved obligation → Twin scenario → Mandate → Delegation → Spend intent → Policy decision → Solana transaction → Settlement → Ledger entry; gaps, anomalies, integrity result, `renderTraceText` |
| Privacy | Salted commitments, `public`/`auditor` redaction profiles, trace privacy levels, identifier masking, secret-field guard on every append |
| Explorer | `buildExplorerUrl` for **localnet** and **Devnet** only (mainnet is refused) |
| Fixtures | `success`, `over_limit`, `revoked_mandate`, `mismatched_vendor` (deterministic, synthetic) |
| Reference policy | `evaluateSpendIntent` / `LedgerProjection.evaluateIntent` – a pure mirror of the documented rules, used for fixtures and explanation. **Not** the enforcement point |

## Not implemented (future roadmap)

Database/persistent stores, event-bus subscriptions, on-chain reads/verification of transactions (the ledger trusts settlement events
produced by FluxFlow), multi-currency, cross-checking recorded decisions against the ledger's own evaluation, UI components, signing of audit events.

## Run it

```bash
npm install --no-package-lock   # installs typescript + @types/node only; do not commit a lockfile
npm test                        # tsc (strict) + node:test, 60 tests
```

Requires Node ≥ 22 (tests use `node:test` and `import.meta.dirname`). The `source/` directory itself has **no runtime dependencies** and no Node APIs:
SHA-256 is implemented in pure TypeScript (and cross-checked against `node:crypto` in tests).

## 30-second example

```ts
import { InMemoryEventStore, LedgerConsumer, buildFixture, buildProofTrace, renderTraceText } from './source/index.js';

const store = new InMemoryEventStore();
const fixture = await buildFixture('success', store);          // synthetic contract → mandate → payment → settlement
const ledger = new LedgerConsumer(store);
await ledger.catchUp();

ledger.projection.taskEconomics();                              // cost 1,000 · revenue 1,800 · margin 800 USDC (units are minor, as strings)
ledger.projection.mandateAllowance('mdt_acme_compute_q4', '2026-11-07T13:00:00Z');

const trace = buildProofTrace(await store.readFrom(0), { settlementId: fixture.expected.settlementId }, { privacy: 'auditor' });
console.log(renderTraceText(trace));                            // 12 numbered steps incl. Devnet explorer link
```

See `HANDOFF.md` for the public interface and integration contract, `ASSUMPTIONS.md` for decisions that need confirmation.
