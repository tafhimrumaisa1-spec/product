# FluxMandate registry client

Browser-safe, wallet-injected client for the deployed Anchor registry at
`E7MjFsDybvfCaoNWopicKzB4oAtHBWTVAC5ZX9ajWJRq` on Solana Devnet.

It derives the registry and replay-receipt PDA namespaces and constructs
`initialize_company`, `commit_contract`, `link_mandate`,
`set_mandate_status`, and `execute_payment` through
`@anchor-lang/core` 1.2.2 and its required legacy-compatible
`@solana/web3.js` 1.99.0 client. The host injects an Anchor `Wallet`; this
package never creates, reads, serializes, or stores private keys.

```ts
const client = createRegistryClient({ connection, wallet, cluster: "devnet" });
const result = await client.initializeCompany(companyId32);
console.log(result.explorerUrl);
```

## Boundaries

- Devnet and the canonical program ID are enforced.
- IDs and commitments must be exactly 32 bytes; derive them from canonical,
  salted inputs outside this package.
- The currently deployed Devnet binary is the registry-only release. The
  checked-in source adds delegated SPL-token enforcement, periodic caps, and
  replay-protected receipts, but those capabilities are not live until the
  program is rebuilt, tested, and upgraded on Devnet.
- The UI should fetch resulting accounts before describing them as verified.
- The minimal checked-in IDL covers transaction construction only. Use the
  generated IDL for account decoding.
- No live browser transaction was performed here; tests use recording fakes
  and deterministic PDA vectors.

Run `npm install`, `npm run typecheck`, and `npm test`.
