# ASSUMPTIONS

1. **Event contract is mine to define.** The master context gives no event schema (FluxGraph presumably owns one). I defined the 14 events in `events.ts`; FluxGraph should adopt or map to them. Mapping is mechanical because the ledger only reads `type` + `payload`.
2. **Money:** decimal strings of integer minor units, 6 decimals, currency `USDC` (Devnet test asset). No floats.
3. **Human vs AI actors** are distinguished by the id prefix `human:`; anything else cannot approve obligations, mandates or delegations (supports "AI cannot independently approve mandates"). Revocation by any actor is accepted (fail-safe direction).
4. **One decision per intent.** A later decision for the same intent is quarantined (`DECISION_CONFLICT`).
5. **Approved decisions reserve allowance** until settled or failed; remaining allowance = limit − settled − pending.
6. **Period cap windows** are fixed 30-day-style windows starting at the mandate's `startsAt`.
7. **Ledger entry** is derived 1:1 from a booked settlement (`le_<settlementId>`), not a separate event, so it can always be rebuilt. Accounts are `expense:vendor:<id>` (debit) and `treasury:<currency>` (credit).
8. **Margin basis points** = `margin × 10,000 / revenue`, integer, truncated toward zero; `null` when revenue is 0.
9. **Quarantine instead of rejecting at the store.** The audit log should record what was *attempted* (including duplicates); projections decide what counts. The store only rejects malformed envelopes, conflicting re-use of an `eventId`, and secret-looking fields.
10. **Quarantined events are not evidence** in FluxProof traces; they appear under `anomalies`.
11. **Fixture cryptography is fake.** Signatures/addresses are SHA-256-derived base58 strings of correct shape; the commitment salt in fixtures is a public test value.
12. **Explorer:** localnet uses `?cluster=custom&customUrl=<rpc>` (default `http://127.0.0.1:8899`); this URL scheme was written from knowledge of the Solana Explorer, **not verified against the live site** in this session (no network use).
13. **Test runner:** Node's built-in `node:test` (Node ≥ 22) to avoid a test-framework dependency.
14. **Dates:** fixtures are set in Nov 2026 around the delivery date; they are fixed strings, never `Date.now()`.
