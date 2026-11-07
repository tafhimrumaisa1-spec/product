# FluxMandate registry security boundary

## Enforced on-chain

`execute_payment` performs a classic SPL Token `TransferChecked` CPI in the same
atomic transaction as its policy checks and state update. It requires:

- the configured agent to sign;
- an active mandate inside its start/expiry window;
- the exact source token account bound in `MandateLink.delegation`;
- the exact configured mint;
- a destination token account owned by the configured vendor;
- the mandate PDA to be the source account's approved SPL delegate;
- sufficient remaining SPL delegation allowance;
- sufficient source token balance;
- a positive amount within the mandate's fixed-period cap; and
- a new `PaymentReceipt` PDA derived from the mandate and `payment_id`.

The receipt PDA prevents the same payment identifier from being consumed twice.
The mandate tracks cumulative spend in fixed windows anchored at `starts_at`.
Creating the receipt, transferring tokens and updating cap state are atomic: if
any step fails, all state and balance changes roll back.

## Required setup

Before an agent can execute a payment, the treasury token-account owner must
approve the mandate PDA as its SPL Token delegate. That approval is a separate
wallet transaction and should be bounded to no more than the commercial
authority the company intends to expose. The mandate binds the exact delegated
source token account, vendor owner, asset mint, agent, period cap and time window.

## Not enforced or supported

- Only the classic SPL Token program is supported; Token-2022 extensions are not.
- The program does not validate an asset's fiat value or assert that a mint is
  official USDC. The company selects the mint when it creates the mandate.
- The program cannot prevent the treasury owner from moving its own assets by a
  different path. It prevents the delegated agent from exceeding this mandate.
- Contract documents and clause text remain off-chain. The registry stores only
  fixed-size commitments and identifiers.
- There is no multisig, governance timelock, oracle, durable nonce, sponsored fee
  payer, receipt close path or account migration instruction in the hackathon build.
- The company authority and program upgrade authority remain trust assumptions.

## Deployment and migration warning

This version extends `MandateLink` and changes `link_mandate` by adding
`period_seconds`. It was upgraded on Devnet in slot `519737941`. Accounts created
with the prior layout are incompatible and need recreation or a future migration
instruction. The hackathon deployment had no known mandate accounts when this
layout was introduced.

## Verified locally

Pure Rust tests cover accumulation, cap rejection without mutation, fixed-window
reset, zero amounts, inactive mandates, expiry and lifecycle transition rules.
The Anchor build, Devnet program upgrade, synthetic settlement and independent
over-cap rejection are verified. The permitted 1,260-token transfer finalized in
slot `519741564`; the 5,200-token attempt failed in slot `519741574` with
`6017 CapExceeded` while its SPL delegate allowance remained sufficient.
