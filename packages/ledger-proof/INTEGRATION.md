# Canonical integration

This package was reviewed and imported from the Agent 07 FluxLedger/FluxProof delivery.

## Boundary

- Deterministic, framework-independent event ledger and proof-trace library.
- No signing, key custody, RPC calls, AI decisions, or on-chain enforcement.
- Money remains decimal strings of minor units at this boundary.

## Verification

Run from this directory:

```bash
npm install --no-package-lock
npm run typecheck
npm test
```

Generated `.build/`, `node_modules/`, and package-local lockfiles are ignored.

## Root integration still required

The canonical root should declare this directory as a workspace package before application code imports `@fluxmandate/ledger-proof`. FluxFlow and the Anchor registry must remain the sources of settlement evidence and authority state respectively; the reference policy in this package is explanatory, not authoritative enforcement.
