# FluxMandate Devnet golden-path harness

Creates disposable classic SPL-token assets and exercises the deployed
FluxMandate program with the local Solana CLI wallet. It never prints or stores
private-key bytes. All generated assets are synthetic and have no monetary
value.

The run performs:

1. create a six-decimal synthetic mint;
2. create treasury and vendor token accounts;
3. initialize a company and commit synthetic contract evidence;
4. link a 4,000-token, 30-day mandate;
5. approve the mandate PDA as the treasury token-account delegate;
6. activate the mandate and execute a 1,260-token payment; and
7. submit a 5,200-token attempt and require an on-chain cap rejection.

The vendor defaults to the public Phantom address used by the hackathon demo.
Override it with `FLUX_VENDOR_WALLET`. The signer defaults to
`~/.config/solana/id.json`; override it with `SOLANA_KEYPAIR`.

Run only on Devnet:

```bash
npm run devnet:golden-path
```

Public transaction evidence is written under `evidence/`. No keypair or seed is
written there.
