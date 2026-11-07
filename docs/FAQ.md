# FAQ

## Does the AI control money?

No. Groq receives synthetic contract text and returns a proposal. It has no signer, wallet endpoint or mandate-approval capability.

## Is the contract stored on Solana?

No. Full contract text and clause evidence remain off-chain. The registry is designed for salted commitments and bounded authority state.

## Does the current build settle on Devnet?

Not yet as a verified end-to-end claim. The Anchor registry compiles locally and FluxFlow passes mock tests, but the real adapter and Devnet deployment still require verification.

## What happens when Groq is unavailable?

The API returns a deterministic synthetic replay and labels it as replay. The UI must not describe that result as live AI.

## What if the model extracts the wrong term?

Material terms require human review. Deterministic arithmetic and policy code operate only on the reviewed values. Extraction accuracy on a broad contract corpus has not been measured.

## Does FluxMandate hold funds?

The intended design is non-custodial: the company retains its treasury and grants bounded authority. Production custody and regulatory treatment require specialist review.

## Why Solana?

The target live path needs an enforcement and evidence layer independent of the agent. Solana offers programmable state and low-cost settlement suitable for machine payments. A signed database could provide audit history, but not the same independent payment boundary.
