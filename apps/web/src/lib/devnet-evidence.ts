export const DEVNET_EVIDENCE = {
  programId: "E7MjFsDybvfCaoNWopicKzB4oAtHBWTVAC5ZX9ajWJRq",
  runId: "9f606857-f1eb-4f1f-877b-df3f15eb6018",
  authorized: {
    signature: "eDFgXQ17fLKvgt8J33k5po3nVTXqYXGE1o6ajQmjF1RkZmZLhpRyiYS8e4aSDxYWTpyC15DPbhYUApMM8xoV9xQ",
    slot: 519741564,
    amount: "1,260 DemoUSD",
  },
  rejected: {
    signature: "3sognxbcxsbcZbUhnwNKmcAoWeB2YQB97LP5yuRrRdHLoMkQL1LR6Fqo9drFPUrnkFgKGkqBpTRBZfuRPW17TwSR",
    slot: 519741574,
    amount: "5,200 DemoUSD",
    error: "6017 CapExceeded",
  },
} as const;

export function devnetTransaction(signature: string) {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}
