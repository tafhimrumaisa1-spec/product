# FluxMandate

**The living financial authority system for autonomous companies.**

FluxMandate converts commercial agreements into reviewed obligations, deterministic company simulations, and bounded financial authority that can be verified on Solana.

## Golden path

`Contract → AI proposal → Human approval → FluxTwin → FluxMandate → Agent payment → FluxLedger → FluxProof`

## Workspace

- `apps/web` — public explanation and no-login guided demo
- `packages/contracts` — evidence-bound extraction and human-only obligation review
- `packages/graph` — strict economic graph, lifecycle machines and audit-chain validation
- `packages/domain` — shared FluxGraph types and lifecycle rules
- `packages/twin` — compatibility calculator plus full multi-scenario FluxTwin engine
- `packages/devnet-harness` — reproducible synthetic Devnet enforcement proof
- `programs/flux-mandate-registry` — Anchor semantic registry
- `docs` — architecture, evidence and reconciled submission materials

## Implemented demo

- Live Groq contract extraction with strict server-side validation
- Human approval checkpoint before authority creation
- Deterministic FluxTwin runway and safe-to-deploy calculations
- Local Anchor registry for contract commitments and mandate state
- Explicit Live AI and Verified Replay modes
- Phantom browser connection on Solana Devnet
- Recorded Devnet settlement plus an on-chain `6017 CapExceeded` rejection
- Deterministic in-browser replay of the same decision boundary

Replay mode is intentionally labelled and remains available when an AI provider or Devnet is unavailable.

## Devnet deployment

The FluxMandate authority registry is deployed and executable on Solana Devnet:

- Program: `E7MjFsDybvfCaoNWopicKzB4oAtHBWTVAC5ZX9ajWJRq`
- Explorer: https://explorer.solana.com/address/E7MjFsDybvfCaoNWopicKzB4oAtHBWTVAC5ZX9ajWJRq?cluster=devnet

The bounded-payment upgrade is deployed. Its source enforces the agent, source
token account, vendor owner, mint, active window, fixed-period cap, delegated
allowance and replay-protected payment receipt atomically. End-to-end token
settlement is verified by the synthetic Devnet golden path. Public transaction
evidence is checked in under `packages/devnet-harness/evidence/` and linked from
the proof screen.

## Local development

Run from Ubuntu/WSL:

```bash
cd /mnt/g/FLUXMANDATE/product
npm --prefix apps/web install
npm run dev
```

Open `http://localhost:3000`.

Copy `apps/web/.env.example` to `apps/web/.env.local` and provide a server-only `GROQ_API_KEY` to use live extraction. Never prefix AI secrets with `NEXT_PUBLIC_`.

## Safety

This hackathon build uses synthetic contracts and Devnet/local assets only. AI proposes; humans approve; deterministic code calculates; Solana enforces.

