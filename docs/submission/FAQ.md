# FAQ

## Privacy
**Is my contract uploaded to a blockchain?**
No. Contract documents stay private and off-chain. Only a salted commitment (a hash that cannot be guessed without the salt), authority state and settlement evidence are on-chain.

**Does the AI provider see my contract?**
Extraction requires sending contract text to the AI service. In this demo only synthetic contracts are used. A production deployment would need a data-processing agreement, a no-training/zero-retention configuration, or a self-hosted model. This is a roadmap item, not a current guarantee.

**What does an observer learn from the chain?**
That a mandate exists, its status and payment activity, and the vendor/recipient addresses involved. Transaction amounts and counterparties on a public chain are visible. Teams with confidentiality needs would require additional measures (not implemented).

## Custody
**Does FluxMandate hold our money?**
No. Funds stay in the company's treasury. FluxMandate records and enforces spending authority.

**Can the AI move funds?**
No. The AI has no signing keys and no endpoint that creates mandates or sends payments.

**Who can approve a mandate?**
A human with approval rights in the application. In the demo this is the presenter.

**What if the agent is compromised?**
It can only attempt payments within the mandate's limits. The authority can pause or revoke the mandate through the on-chain lifecycle; maximum exposure is bounded by the cap and period.

## AI errors
**What if the AI extracts the wrong amount or date?**
Each field links to its source clause; low-confidence or ambiguous items are flagged; every material obligation needs human approval. Edits flow deterministically into the simulation and mandate.

**Can the human just click "approve all" and miss errors?**
Possibly — automation bias is real. Mitigations are mandatory per-item review, flagged items, and visible source clauses. Residual risk remains and is why human accountability stays with the approver.

**How accurate is extraction?**
Not measured on a broad real-contract corpus in this prototype. Do not treat the demo as an accuracy claim.

**Can the AI's explanations be wrong?**
Yes. Numbers shown in the product come from deterministic code; AI text only explains them and is not an input to enforcement.

## Regulatory boundaries
**Is this legal or financial advice?**
No. It is software that records and enforces limits users approve.

**Is it a money transmitter / payment institution?**
We do not claim a regulatory classification. The non-custodial design is intended to keep the product on the software side, but treatment depends on jurisdiction, how funds move and who controls keys. Qualified legal advice is required before any production use with real funds.

**Does it replace accounting or contract review?**
No. It supports them. A lawyer's interpretation of a contract and an accountant's treatment of an obligation remain authoritative.

**Why Devnet only?**
To avoid real financial risk and regulatory exposure while the design is evaluated. Mainnet use is conditional on the roadmap's audit and legal steps.

## Product
**Do you support real contracts today?**
The demo uses synthetic contracts. Real-contract use is not recommended until evaluation and security work are done.

**Does a rejected payment cost fees?**
The guided replay rejects before submission, moves no funds and costs nothing. In the recorded Devnet proof, the over-cap transaction reaches the program and fails on-chain, so the submitting Devnet wallet pays the test-network fee while no token value moves.
