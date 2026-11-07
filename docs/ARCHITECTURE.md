# FluxMandate architecture

> Implementation status: the browser demo, live Groq extraction, deterministic simulation, mock execution package, ledger/proof package and replay path exist. The Anchor registry is deployed and executable on Devnet at `E7MjFsDybvfCaoNWopicKzB4oAtHBWTVAC5ZX9ajWJRq`. Registry instructions and the payment path still require end-to-end transaction verification. Any claim about payment enforcement describes the target live path until that evidence exists.

## Product boundary

FluxMandate is the contract-to-authority layer between company systems and autonomous software. It does not replace accounting systems, banks, exchanges, or Solana payment primitives.

## Modules

- **FluxShell** — judge-first public experience and company command center.
- **FluxGraph** — shared economic entities and immutable events.
- **FluxContracts** — evidence-backed obligation proposals.
- **FluxTwin** — deterministic cash and runway simulation.
- **FluxMandate** — contract-linked authority registry.
- **FluxFlow** — delegated execution and payment routing.
- **FluxLedger** — reconciliation and agent economics.
- **FluxProof** — evidence and settlement trace.

## Trust split

| Plane | Responsibility |
| --- | --- |
| AI | Extract and explain proposed terms |
| Human | Review and approve material authority |
| Deterministic services | Validate, calculate, reconcile |
| Solana | Record authority and enforce payment constraints |

Contracts remain private. Only salted commitments, authority state, delegation references, and settlement evidence are suitable for public chain state.

## Data flow

```text
Synthetic contract text (private, off-chain)
       │
       ▼
Groq proposal ── schema validation ── human review
       │                                  │
       │                                  ▼
       │                           FluxTwin simulation
       │                                  │
       ▼                                  ▼
FluxGraph events ───────────────► FluxMandate registry
                                          │
Agent spend intent ─────────────► FluxFlow policy/execution
                                          │
                                          ▼
                                 FluxLedger ─► FluxProof
```

## Implemented versus pending

| Capability | Current evidence | Status |
| --- | --- | --- |
| Contract extraction | Server-only Groq route, strict validation, deterministic fallback | Implemented |
| Human checkpoint | Explicit guided-demo approval step | Implemented for demo |
| Cash/runway simulation | Pure deterministic FluxTwin calculations | Implemented |
| Registry | Anchor company, commitment and mandate accounts; bounded lifecycle | Deployed executable on Devnet; instruction evidence pending |
| Payment execution | Mock-first FluxFlow with passing unit/security tests | Implemented against mocks; real adapters unverified |
| Ledger and proof | Typed event and trace package | Integrated locally; host wiring pending |
| Phantom | Browser connection control | Implemented; signing flow pending |
| Devnet settlement | Real signature and Explorer evidence | Not yet verified |

## Privacy boundary

The AI provider receives only the synthetic text submitted to the extraction endpoint. It never receives a wallet signer. Full documents, clause text and API keys must remain off-chain. The public registry is intended for salted commitments and bounded authority state, not document storage.

