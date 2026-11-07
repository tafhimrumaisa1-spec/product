/**
 * x402 V2 SANDBOX EXAMPLE — NOT on FluxFlow's critical path, NOT compiled by tsconfig,
 * NOT exercised by tests. Direct delegated transfer (src/executor.ts) is the supported path.
 *
 * Based on the official guide: https://solana.com/docs/payments/agentic-payments/x402
 * and the spec: https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md
 *
 * V2 only: CAIP-2 network identifier, PAYMENT-REQUIRED / PAYMENT-SIGNATURE / PAYMENT-RESPONSE
 * headers are produced and parsed by the x402 libraries (never hand-built here).
 *
 * Extra packages (install in a separate sandbox project, not in FluxFlow):
 *   @x402/core @x402/express @x402/fetch @x402/svm express @scure/base @solana/kit
 *
 * Run (two terminals, Devnet, DISPOSABLE keys only):
 *   FACILITATOR_URL=<x402 V2 facilitator listing exact support for the network at /supported>
 *   SOLANA_PAY_TO=<devnet recipient wallet; its token account for the mint must already exist>
 *   tsx examples/x402-v2-sandbox.ts server
 *   SANDBOX_AGENT_KEY=<base58 disposable devnet key, from the environment only> tsx examples/x402-v2-sandbox.ts client
 *
 * Security: the client key comes from the environment of a disposable Devnet account. It is
 * never read from source, never logged, and never reaches browser code. The client policy
 * below caps each payment, per the guide's advice to bound autonomous spending.
 */
import express from 'express';
import { base58 } from '@scure/base';
import { createKeyPairSignerFromBytes } from '@solana/kit';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { paymentMiddleware, x402ResourceServer } from '@x402/express';
import { x402Client, wrapFetchWithPayment } from '@x402/fetch';
import { ExactSvmScheme as ExactSvmServer } from '@x402/svm/exact/server';
import { ExactSvmScheme as ExactSvmClient } from '@x402/svm/exact/client';

const DEVNET = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';
const DEVNET_USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const MAX_BASE_UNITS = 10_000n; // 0.01 USDC per payment

function need(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') throw new Error(`Missing environment variable ${name}`);
  return v;
}

async function server(): Promise<void> {
  const facilitator = new HTTPFacilitatorClient({ url: need('FACILITATOR_URL') });
  const resourceServer = new x402ResourceServer(facilitator).register(DEVNET, new ExactSvmServer());
  const app = express();
  app.use(
    paymentMiddleware(
      {
        'GET /weather': {
          accepts: [{ scheme: 'exact', price: '$0.001', network: DEVNET, payTo: need('SOLANA_PAY_TO') }],
          description: 'Sandbox weather data',
          mimeType: 'application/json',
        },
      },
      resourceServer,
    ),
  );
  app.get('/weather', (_req, res) => res.json({ weather: 'sunny', temperature: 21 }));
  app.listen(4021, () => console.log('x402 V2 sandbox server on :4021'));
}

async function client(): Promise<void> {
  const signer = await createKeyPairSignerFromBytes(base58.decode(need('SANDBOX_AGENT_KEY')));
  const x402 = new x402Client();
  x402.registerPolicy((_version, reqs) =>
    reqs.filter(({ network, asset, amount }) => network === DEVNET && asset === DEVNET_USDC && BigInt(amount) <= MAX_BASE_UNITS),
  );
  x402.register('solana:*', new ExactSvmClient(signer));
  const paidFetch = wrapFetchWithPayment(fetch, x402);
  const res = await paidFetch('http://127.0.0.1:4021/weather');
  console.log(await res.json(), 'settlement header present:', res.headers.get('PAYMENT-RESPONSE') !== null);
}

const mode = process.argv[2];
if (mode === 'server') await server();
else if (mode === 'client') await client();
else console.log('usage: tsx examples/x402-v2-sandbox.ts <server|client>');
