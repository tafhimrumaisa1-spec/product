# FluxMandate

**The living financial authority system for autonomous companies.**

FluxMandate converts commercial agreements into reviewed obligations, deterministic company simulations, and bounded financial authority that can be verified on Solana.

## Golden path

`Contract → AI proposal → Human approval → FluxTwin → FluxMandate → Agent payment → FluxLedger → FluxProof`

## Workspace

- `apps/web` — public explanation and no-login guided demo
- `packages/domain` — shared FluxGraph types and lifecycle rules
- `packages/twin` — deterministic FluxTwin calculations
- `programs/flux-mandate-registry` — Anchor semantic registry
- `docs` — architecture, demo, and agent integration notes

## Local development

Run from Ubuntu/WSL:

```bash
cd /mnt/g/FLUXMANDATE/product
npm --prefix apps/web install
npm run dev
```

Open `http://localhost:3000`.

## Safety

This hackathon build uses synthetic contracts and Devnet/local assets only. AI proposes; humans approve; deterministic code calculates; Solana enforces.

