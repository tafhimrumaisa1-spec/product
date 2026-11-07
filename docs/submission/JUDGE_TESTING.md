# Judge Testing Instructions

Three independent ways to evaluate. Start with A (2 minutes), then B or C. **All use synthetic contracts and Devnet assets. No real money is involved. Do not connect a wallet that holds real funds.**

Demo: https://fluxmandate.vercel.app

---
## A. No-wallet guided demo (2–4 minutes)
**Needs:** a browser. No sign-in. No wallet.

1. Open https://fluxmandate.vercel.app and click **Launch live demo**.
2. **Load contract.** Choose the synthetic compute-services contract.
   *Expect:* extracted vendor, amount, duration, periodic cap, payment schedule, renewal and termination terms, each with a source clause.
3. **Review.** Open the flagged item. Compare to the clause, approve each obligation.
   *Expect:* you cannot proceed to a mandate until every material obligation is approved.
4. **Company effect.** Open FluxTwin.
   *Expect:* cash, burn and runway before/after. Re-running gives identical numbers.
5. **Create mandate.** Click **Create mandate**.
   *Expect:* mandate shows vendor, cap, period, agent, expiry.
6. **Authorized payment.** Click **Run agent payment (within limit)**.
   *Expect:* approved and settled; ledger row appears.
7. **Over-limit payment.** Click **Run agent payment (exceeds cap)**.
   *Expect:* rejected with a reason; balance unchanged.
8. **Proof.** Open the proof drawer on the settled payment.
   *Expect:* contract → obligation → mandate → agent → task → settlement, plus a Solana transaction reference.

**What this mode proves:** the product flow and the decision logic. **What it does not prove:** that you personally signed or sent a Devnet transaction. Guided mode may use pre-recorded chain evidence; the UI should label it as such.

---
## B. Inspect the recorded Devnet run (2–4 minutes)
**Needs:** a browser. No wallet and no funds.

1. Complete Mode A and open the final **FluxProof** screen.
2. Open **Authorized 1,260 DemoUSD**.
   *Expect:* Solana Explorer Devnet shows a successful `ExecutePayment` transaction.
3. Open **Rejected 5,200 DemoUSD**.
   *Expect:* Explorer shows a failed transaction with custom program error `6017 CapExceeded`.
4. Compare the independent SPL allowance (10,000) with the mandate period cap
   (4,000). The failure is therefore the mandate policy—not an exhausted token allowance.

**Safety checks you can make:**
- The app never asks for a seed phrase or private key.
- Connecting Phantom is optional and requests only account visibility.
- Guided payment buttons are labelled deterministic; they do not ask a judge to spend funds.
- Browser source and network responses contain no API keys.

---
## C. Reproduce with the CLI harness (5–10 minutes)
**Needs:** the repository, Node 24, a disposable Solana CLI Devnet wallet and Devnet SOL.

```bash
cd /mnt/g/FLUXMANDATE/product
npm --prefix packages/devnet-harness install --no-package-lock --ignore-scripts
npm run devnet:golden-path
```

*Expect:* a fresh synthetic mint, company, contract commitment and mandate; a
successful 1,260-token transfer; a submitted 5,200-token transaction rejected
with `6017 CapExceeded`; and a public JSON evidence record. Never use a wallet
holding real assets.

---
## What to report
If something fails, note mode (A/B/C), step number, what you saw, and browser/wallet version. Failures in the live path should degrade to a clear message, not a blank screen.
