# Judge testing

FluxMandate requires no sign-in and uses synthetic agreements and test assets only.

## Guided path

1. Open the public site and select **Launch live demo**.
2. Choose **Live AI** to run server-side Groq extraction, or **Replay** for the deterministic fixture.
3. Extract the synthetic Axiom Compute agreement.
4. Inspect clause-linked obligation proposals and approve them as the human reviewer.
5. Review FluxTwin's deterministic cash, commitment and runway impact.
6. Inspect the bounded mandate draft. Until the Devnet deployment is complete, this is a labelled demo state.
7. Try the in-limit payment and observe the mock policy authorization.
8. Try the over-limit payment and observe the mock policy rejection.
9. Open FluxProof to follow contract → obligation → mandate → agent → settlement → ledger.

## Truth labels

- **Live AI** means Groq produced and the server validated the proposal.
- **Verified replay** means the deterministic fixture was used and no live-AI claim is made.
- **Synthetic** means no real contract or money is involved.
- **Devnet** means the transaction has no financial value.
- **Mock policy** means the deterministic client path was exercised, not that a transaction settled on-chain.

## Security checks

- The browser never receives `GROQ_API_KEY`.
- The AI endpoint cannot approve mandates or access wallet signers.
- Contract text is not written on-chain.
- Only approved commitments and bounded authority belong in the registry.

## Pending live checks

Do not claim these until a final build records the evidence:

- Anchor registry deployed on Devnet with a public program address.
- A successful Devnet transaction linked from FluxProof.
- An over-limit attempt rejected by the actual on-chain execution path.
- Ledger/proof UI driven by integrated package events rather than the guided fixture.
