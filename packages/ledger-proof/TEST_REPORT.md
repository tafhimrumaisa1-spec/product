# TEST REPORT

## What was actually run (delivery environment)
```
tsc -p tsconfig.json --typeRoots /opt/node-tools/node_modules/@types   # TypeScript 7.0.2, strict, 0 errors
node --test ".build/tests/*.test.js"                                   # Node v22.23.4
```
Result: **60 tests, 60 passed, 0 failed** (~0.5 s).

| File | Tests | Covers |
|---|---|---|
| `crypto.test.ts` | 4 | Pure SHA-256 vs `node:crypto` (padding boundaries, unicode), canonical JSON, strict money parsing/formatting |
| `store.test.ts` | 7 | Append-only sequence + hash chain, idempotent append, conflict on same id/different content, validation, secret-field rejection, frozen events, cursor reads, tamper/reorder/gap detection |
| `ledger.test.ts` | 25 | Success / over-limit / revoked-mandate / mismatched-vendor fixtures; all 8 projections; period-window rollover; reference policy codes; idempotent `apply`; consumer catch-up; rebuild equality; out-of-order rejection; 4 duplicate-settlement variants; settlement for rejected intent; amount/vendor/signature mismatch; pending reservation + failure release; non-human approvers; mandate > obligation; invalid payloads; duplicate revenue / conflicting decision; negative and null margin; JSON-safe snapshot |
| `proof.test.ts` | 14 | 12-step order and completeness; query by settlement; localnet links; rejection explanation; revocation entry; vendor mismatch wording; internal/auditor/public privacy (leak checks); tampered log; missing upstream records; quarantined duplicates; non-human mandate not shown as evidence; pending/failed outcomes; query errors; stable text rendering |
| `misc.test.ts` | 10 | Synthetic base58 shape; explorer URLs (devnet, localnet, address) and refusals (mainnet, junk ids, unsafe options); every reason code renders; commitments; redaction helpers; secret guard; no secret-looking fields in fixtures; source-tree scan for env/network/key-material patterns |

## Not verified / caveats
- `npm test` itself was **not** run: package installs are disabled in this environment, so `@types/node` was supplied to `tsc` via `--typeRoots` from a shared tools directory. `package.json` declares `typescript ^5.6.0`, but the code was only compiled with **TypeScript 7.0.2**; compatibility with 5.x is expected, not confirmed.
- Explorer URL formats were written from knowledge of the Solana Explorer and not checked against the live site. Fixture signatures/addresses are synthetic and do not exist on any cluster.
- No integration test with the other modules (none were available). No performance/load testing. No test of a database-backed `EventStore`.
- The browser/edge claim for `source/` (no Node APIs) is by inspection and the source-scan test; it was not executed in a browser.

## Second self-review (required by the delivery rules)
1. **Contradictions with the product definition** — Checked: no signing, key handling or network code; AI-origin approvals are quarantined; policy evaluator is labelled as non-enforcing; only localnet/Devnet; contract text appears only as optional `excerptPreview` (stripped by redaction) plus salted commitments. *Finding:* `excerptPreview` could tempt producers to put contract text in a shared log → documented in HANDOFF limitation 8.
2. **Unnecessary features removed** — Dropped a pointless re-export in `policy.ts`; kept scope to the requested list (no DB, no UI, no on-chain reads). Kept the period cap because the golden demo extracts a "periodic cap".
3. **Exposed secrets** — Automated scan test over `source/` (env access, `NEXT_PUBLIC`, `fetch`, PEM headers, `sk-` keys, `Keypair`, non-crypto randomness); fixtures scanned for secret-looking keys; store refuses such keys. *Finding:* an early version of a comment tripped the scan; reworded.
4. **Type safety and error states** — Strict + `noUncheckedIndexedAccess`; exhaustive `never` switch over event types; bad payloads become `INVALID_PAYLOAD` anomalies instead of exceptions; handlers validate before mutating, so a failing event leaves state untouched; typed errors (`EventStoreError`, `LedgerError`, `ProofError`, `ExplorerUrlError`, `MoneyError`). *Finding:* settlement currency mismatch was initially reported with the wrong reason code → fixed to `UNSUPPORTED_CURRENCY`.
5. **Revisions made** — the three fixes above plus test-typing cleanup. Remaining known gaps are listed in HANDOFF §6.
