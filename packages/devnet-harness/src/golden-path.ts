import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { Wallet } from "@anchor-lang/core";
import {
  TOKEN_PROGRAM_ID,
  approve,
  createMint,
  getAccount,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  PROGRAM_ID,
  createRegistryClient,
  deriveCompanyRegistry,
  deriveMandateLink,
  derivePaymentReceipt,
  type Id32,
} from "../../registry-client/src/index.js";

const RPC_URL = "https://api.devnet.solana.com";
const DEFAULT_VENDOR = "CMgP3ZC8JEn7iKJK7yPwtHxjSmtkymjv1XH4dK5PafnE";
const DECIMALS = 6;
const UNIT = 10n ** BigInt(DECIMALS);
const PERIOD_CAP = 4_000n * UNIT;
const DELEGATED_ALLOWANCE = 10_000n * UNIT;
const AUTHORIZED_PAYMENT = 1_260n * UNIT;
const OVER_CAP_PAYMENT = 5_200n * UNIT;
const CONFIRM = { commitment: "confirmed" as const, preflightCommitment: "confirmed" as const };

async function main() {
  if (process.env.SOLANA_URL && process.env.SOLANA_URL !== RPC_URL) {
    throw new Error(`Refusing non-Devnet RPC: ${process.env.SOLANA_URL}`);
  }

  const connection = new Connection(RPC_URL, "confirmed");
  const payer = await loadKeypair(process.env.SOLANA_KEYPAIR || path.join(homedir(), ".config", "solana", "id.json"));
  const wallet = new Wallet(payer);
  const vendor = new PublicKey(process.env.FLUX_VENDOR_WALLET || DEFAULT_VENDOR);
  const balance = await connection.getBalance(payer.publicKey, "confirmed");
  if (balance < 100_000_000) throw new Error("The Devnet signer needs at least 0.1 SOL.");

  const runId = randomUUID();
  const companyId = id32(`${runId}:company`);
  const contractId = id32(`${runId}:contract`);
  const mandateId = id32(`${runId}:mandate`);
  const obligationId = id32(`${runId}:obligation`);
  const paymentId = id32(`${runId}:payment:authorized`);
  const overCapPaymentId = id32(`${runId}:payment:over-cap`);
  const documentCommitment = id32(`${runId}:synthetic-contract-document`);
  const termsCommitment = id32(`${runId}:approved-terms`);

  console.log(`FluxMandate Devnet run ${runId}`);
  console.log(`Signer: ${payer.publicKey.toBase58()}`);
  console.log(`Vendor: ${vendor.toBase58()}`);

  const mint = await createMint(connection, payer, payer.publicKey, null, DECIMALS, undefined, CONFIRM, TOKEN_PROGRAM_ID);
  const treasury = await getOrCreateAssociatedTokenAccount(connection, payer, mint, payer.publicKey, false, "confirmed", CONFIRM, TOKEN_PROGRAM_ID);
  const vendorAccount = await getOrCreateAssociatedTokenAccount(connection, payer, mint, vendor, false, "confirmed", CONFIRM, TOKEN_PROGRAM_ID);
  const mintSignature = await mintTo(connection, payer, mint, treasury.address, payer, 10_000n * UNIT, [], CONFIRM, TOKEN_PROGRAM_ID);

  const client = createRegistryClient({
    connection,
    wallet,
    cluster: "devnet",
    confirmOptions: { ...CONFIRM, skipPreflight: false },
  });
  const companyRegistry = deriveCompanyRegistry(payer.publicKey, companyId);
  const mandateLink = deriveMandateLink(companyRegistry, mandateId);

  const initialized = await client.initializeCompany(companyId);
  const committed = await client.commitContract({
    companyId,
    contractId,
    documentCommitment,
    termsCommitment,
    version: 1,
  });

  const now = BigInt(Math.floor(Date.now() / 1_000));
  const linked = await client.linkMandate({
    companyId,
    contractId,
    mandateId,
    obligationId,
    agent: payer.publicKey.toBase58(),
    vendor: vendor.toBase58(),
    delegation: treasury.address.toBase58(),
    assetMint: mint.toBase58(),
    periodCap: PERIOD_CAP,
    periodSeconds: 30n * 24n * 60n * 60n,
    startsAt: now - 60n,
    expiresAt: now + 90n * 24n * 60n * 60n,
  });

  const approvalSignature = await approve(
    connection,
    payer,
    treasury.address,
    mandateLink,
    payer,
    DELEGATED_ALLOWANCE,
    [],
    CONFIRM,
    TOKEN_PROGRAM_ID,
  );
  const activated = await client.setMandateStatus({ companyId, mandateId, status: "active" });

  const vendorBefore = (await getAccount(connection, vendorAccount.address, "confirmed", TOKEN_PROGRAM_ID)).amount;
  const settled = await client.executePayment({
    companyId,
    mandateId,
    paymentId,
    sourceToken: treasury.address.toBase58(),
    vendorToken: vendorAccount.address.toBase58(),
    assetMint: mint.toBase58(),
    amount: AUTHORIZED_PAYMENT,
  });
  const vendorAfter = (await getAccount(connection, vendorAccount.address, "confirmed", TOKEN_PROGRAM_ID)).amount;
  if (vendorAfter - vendorBefore !== AUTHORIZED_PAYMENT) throw new Error("Authorized settlement balance delta is incorrect.");

  const rejectionClient = createRegistryClient({
    connection,
    wallet,
    cluster: "devnet",
    confirmOptions: { ...CONFIRM, skipPreflight: true },
  });
  const overCapReceipt = derivePaymentReceipt(mandateLink, overCapPaymentId);
  const rejected = await requireCapRejection(connection, overCapReceipt, () => rejectionClient.executePayment({
    companyId,
    mandateId,
    paymentId: overCapPaymentId,
    sourceToken: treasury.address.toBase58(),
    vendorToken: vendorAccount.address.toBase58(),
    assetMint: mint.toBase58(),
    amount: OVER_CAP_PAYMENT,
  }));

  const evidence = {
    schema: "fluxmandate.devnet-golden-path.v1",
    runId,
    createdAt: new Date().toISOString(),
    cluster: "devnet",
    rpcUrl: RPC_URL,
    programId: PROGRAM_ID,
    signer: payer.publicKey.toBase58(),
    vendor: vendor.toBase58(),
    syntheticAsset: { mint: mint.toBase58(), decimals: DECIMALS, treasuryTokenAccount: treasury.address.toBase58(), vendorTokenAccount: vendorAccount.address.toBase58() },
    accounts: { companyRegistry: companyRegistry.toBase58(), mandateLink: mandateLink.toBase58(), paymentReceipt: settled.accounts.paymentReceipt },
    transactions: {
      mint: transactionEvidence(mintSignature),
      initializeCompany: transactionEvidence(initialized.signature),
      commitContract: transactionEvidence(committed.signature),
      linkMandate: transactionEvidence(linked.signature),
      approveDelegate: transactionEvidence(approvalSignature),
      activateMandate: transactionEvidence(activated.signature),
      authorizedPayment: transactionEvidence(settled.signature),
      overCapAttempt: rejected,
    },
    assertions: {
      authorizedAmountBaseUnits: AUTHORIZED_PAYMENT.toString(),
      vendorBalanceDeltaBaseUnits: (vendorAfter - vendorBefore).toString(),
      periodCapBaseUnits: PERIOD_CAP.toString(),
      delegatedAllowanceBaseUnits: DELEGATED_ALLOWANCE.toString(),
      overCapAmountBaseUnits: OVER_CAP_PAYMENT.toString(),
      authorizedSettlementVerified: true,
      overCapRejected: true,
    },
  };

  const evidenceDirectory = path.resolve(process.cwd(), "evidence");
  await mkdir(evidenceDirectory, { recursive: true });
  const evidencePath = path.join(evidenceDirectory, `devnet-golden-path-${runId}.json`);
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: "utf8", flag: "wx" });

  console.log(`Authorized payment: ${settled.explorerUrl}`);
  console.log(`Over-cap rejection: ${rejected.signature ? rejected.explorerUrl : "confirmed by Devnet simulation logs"}`);
  console.log(`Evidence: ${evidencePath}`);
}

async function loadKeypair(filename: string): Promise<Keypair> {
  const parsed: unknown = JSON.parse(await readFile(filename, "utf8"));
  if (!Array.isArray(parsed) || parsed.length !== 64 || parsed.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    throw new Error("SOLANA_KEYPAIR must point to a 64-byte Solana keypair JSON file.");
  }
  return Keypair.fromSecretKey(Uint8Array.from(parsed));
}

function id32(value: string): Id32 {
  return new Uint8Array(createHash("sha256").update(value).digest());
}

function transactionEvidence(signature: string) {
  return { signature, explorerUrl: explorer(signature) };
}

function explorer(signature: string) {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}

async function requireCapRejection(connection: Connection, paymentReceipt: PublicKey, run: () => Promise<unknown>) {
  let clientMessage = "";
  let clientLogs: string[] = [];
  try {
    await run();
  } catch (error) {
    const record = asRecord(error);
    clientMessage = error instanceof Error ? error.message : String(error);
    clientLogs = Array.isArray(record?.logs) ? record.logs.filter((line): line is string => typeof line === "string") : [];
    if (isCapRejection(`${clientMessage}\n${clientLogs.join("\n")}`)) {
      const signature = extractSignature(clientMessage);
      return { rejected: true, reason: "CapExceeded", signature, explorerUrl: signature ? explorer(signature) : null, logs: clientLogs };
    }
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await delay(500 + attempt * 250);
      const signatures = await connection.getSignaturesForAddress(paymentReceipt, { limit: 5 }, "confirmed");
      for (const candidate of signatures) {
        if (!candidate.err) continue;
        const transaction = await connection.getTransaction(candidate.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
        const logs = transaction?.meta?.logMessages || [];
        if (isCapRejection(logs.join("\n"))) {
          return { rejected: true, reason: "CapExceeded", signature: candidate.signature, explorerUrl: explorer(candidate.signature), logs };
        }
      }
    }
    throw new Error(`Over-cap attempt failed for an unexpected reason: ${clientMessage}`);
  }
  throw new Error("SECURITY FAILURE: the over-cap payment was accepted.");
}

function isCapRejection(value: string) {
  return /CapExceeded|Error Number: 6017|exceeds the current period cap/i.test(value);
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function extractSignature(message: string): string | null {
  const match = message.match(/(?:transaction|signature)\s+([1-9A-HJ-NP-Za-km-z]{64,90})/i);
  return match?.[1] || null;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
