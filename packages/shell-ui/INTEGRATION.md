# FluxShell UI integration

This package is the reviewed intake of Agent 01's FluxShell delivery. It preserves the no-gradient dark grid aesthetic, accessible text-labelled status states, integer-cent UI rules, and the nine-step guided-demo vocabulary.

## Host wiring

1. Add this package to the root workspace and install dependencies.
2. Import `@fluxmandate/shell-ui/styles.css` once from the Next root layout.
3. Render the interactive screens from a client component. `Landing`, `AppShell`, and the screen modules are already marked as client boundaries.
4. Supply a `FluxApi` implementation to each screen. If omitted, the explicitly synthetic `demoApi` is used.
5. Map real FluxContracts, FluxTwin, FluxFlow, FluxLedger, and FluxProof records at the adapter boundary; do not make UI policy decisions authoritative.

```tsx
import "@fluxmandate/shell-ui/styles.css";
import { ContractReview } from "@fluxmandate/shell-ui";

export function Demo({ api }: { api: FluxApi }) {
  return <ContractReview api={api} />;
}
```

## Security and correctness boundaries

- The UI helper uses integer cents and is only an explanatory mirror. Solana remains authoritative.
- Mock records are synthetic and visibly labelled.
- No signer, API key, contract document, or private wallet material belongs in this package.
- The real product uses USDC minor units (six decimals); the host adapter must convert deliberately rather than silently mixing units.
- The package does not yet implement routing, wallet connection, Groq extraction, persistence, or live settlement.
