# Three-Minute Demonstration Script

Total runtime: **3:00**. Spoken narration is about 400 words (~135 wpm). Use the **guided no-wallet mode** for recording; it is deterministic.

> Verified fixture: vendor "Axiom Compute Labs"; total USD 12,000 over three
> months; periodic cap USD 4,000; in-limit payment USD 1,260; over-limit
> payment USD 5,200. The guided clicks are deterministic replay; the proof
> screen links the separately recorded live Devnet transactions.

### 0:00–0:20 — The problem
**Screen:** Landing page, hero visible. Click **Launch Live Demo**.
**Say:** "Companies are starting to let software agents buy compute, data and services. But a contract says 'up to this much, this often.' Nothing turns that sentence into a limit an agent can obey. So teams pick a shared card with no real ceiling, or a human approving every invoice. FluxMandate closes that gap."

### 0:20–0:50 — AI reads the contract
**Screen:** FluxContracts. Load the synthetic compute-services contract. Extracted fields appear with source-clause highlights.
**Say:** "This is a synthetic signed contract. The AI extracts vendor, amount, duration, the periodic cap, payment schedule, renewal and termination terms. Every field points to the clause it came from. The AI proposes; it decides nothing."

### 0:50–1:20 — A human approves
**Screen:** Obligation review list. One item is flagged (auto-renewal notice period). Presenter edits or confirms it, then approves each obligation.
**Say:** "Here the AI flagged the renewal notice as low confidence. A person checks it against the clause and approves it. Each material obligation needs a human decision. The AI cannot approve a mandate, and it never touches signing keys."

### 1:20–1:45 — The company effect
**Screen:** FluxTwin. Before/after cash, burn and runway.
**Say:** "Before any authority is granted, FluxTwin shows what this contract does to cash, burn and runway. These numbers come from deterministic code, not from the AI, so the same inputs always give the same answer."

### 1:45–2:15 — Mandate and an authorized payment
**Screen:** FluxMandate creates the mandate. Agent requests a payment inside the cap; it is approved; status shows settled. Open the proof drawer briefly.
**Say:** "Now the approved terms become a mandate: this vendor, this cap, this period, this agent. The guided payment replays the same 1,260-dollar decision that our recorded Devnet run settled on-chain."

### 2:15–2:35 — The over-limit payment is rejected
**Screen:** Agent requests a payment above the periodic cap. Rejection with reason: "Exceeds periodic cap by [amount]". Balance unchanged.
**Say:** "Now the same agent asks for 5,200 dollars against a 4,000-dollar cap. The proof screen links the failed Devnet transaction: error 6017, CapExceeded, and no funds move."

### 2:35–2:55 — Reconciliation and proof
**Screen:** FluxLedger row showing contract → obligation → mandate → agent → task → settlement. Open FluxProof drawer: clause, approval, mandate state, Solana transaction link.
**Say:** "FluxLedger reconciles the settlement to the contract, obligation, mandate, agent and task. FluxProof shows the full trail. The contract itself stays private; only a salted commitment and the settlement evidence are on-chain."

### 2:55–3:00 — Close
**Say:** "AI interprets. Humans approve. Code calculates. Solana enforces. That's FluxMandate."

## Presenter checklist
- Guided mode loaded and reset (known clean state).
- Browser zoom set so the proof drawer is legible on a projector.
- Fallback plan: if the Devnet path is slow, switch to **verified replay** (see `judge-testing.md`) and say so out loud. Never present replay as a live transaction.
- Do not improvise numbers. Do not say "production-ready".

## Likely interruptions (30-second answers)
- *"What if the AI misreads the contract?"* → "A human approves each obligation and sees the source clause. Deterministic code and Solana only act on approved values."
- *"Who holds the money?"* → "The company's own treasury. FluxMandate sets authority; it doesn't take custody."
