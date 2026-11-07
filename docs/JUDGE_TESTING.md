# Judge testing

FluxMandate requires no sign-in and uses synthetic agreements and test assets only.

## Guided path

1. Open the public site and select **Launch live demo**.
2. Choose **Live AI** to run server-side Groq extraction, or **Replay** for the deterministic fixture.
3. Extract the synthetic Axiom Compute agreement.
4. Inspect clause-linked obligation proposals and approve them as the human reviewer.
5. Review FluxTwin's deterministic cash, commitment and runway impact.
6. Inspect the bounded mandate draft. It represents the policy exercised by the recorded Devnet golden path.
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

## Recorded Devnet evidence

The Proof screen and `docs/DEVNET_EVIDENCE.md` provide:

- The deployed Anchor program and upgrade transaction.
- An authorized synthetic-token transfer.
- An over-cap attempt rejected on-chain with `6017 CapExceeded`.
- A machine-readable evidence record from the reproducible CLI harness.

The connected browser wallet is identity/network UX only; the guided buttons do not submit new transactions.
