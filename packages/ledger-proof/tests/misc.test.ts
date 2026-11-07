import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  ExplorerUrlError, FIXTURE_NAMES, REASON_DEFINITIONS, ReasonCodes, REDACTED, buildFixture, buildExplorerUrl, createSaltedCommitment, describeReason,
  explainDecision, explorerAddressUrl, explorerTxUrl, findSecretFields, generateSalt, isReasonCode, maskIdentifier, redactEvent, redactValue, redactedKeysFor,
  syntheticAddress, syntheticSignature, verifyCommitment, type ReasonCode, type SolanaCluster,
} from '../source/index.js';

const SIG = syntheticSignature('t');
const ADDR = syntheticAddress('t');

test('synthetic signatures/addresses have realistic base58 shape', () => {
  assert.match(SIG, /^[1-9A-HJ-NP-Za-km-z]{64,90}$/);
  assert.match(ADDR, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  assert.equal(syntheticSignature('t'), SIG);
  assert.notEqual(syntheticSignature('u'), SIG);
});

test('explorer URLs: devnet, localnet default and custom RPC, addresses', () => {
  assert.equal(explorerTxUrl('devnet', SIG), `https://explorer.solana.com/tx/${SIG}?cluster=devnet`);
  assert.equal(explorerTxUrl('localnet', SIG), `https://explorer.solana.com/tx/${SIG}?cluster=custom&customUrl=http%3A%2F%2F127.0.0.1%3A8899`);
  assert.equal(explorerTxUrl('localnet', SIG, { localnetRpcUrl: 'http://localhost:9000' }), `https://explorer.solana.com/tx/${SIG}?cluster=custom&customUrl=http%3A%2F%2Flocalhost%3A9000`);
  assert.equal(explorerAddressUrl('devnet', ADDR), `https://explorer.solana.com/address/${ADDR}?cluster=devnet`);
});

test('explorer URLs refuse mainnet, junk ids and unsafe options', () => {
  assert.throws(() => buildExplorerUrl('mainnet-beta' as SolanaCluster, 'tx', SIG), ExplorerUrlError);
  assert.throws(() => buildExplorerUrl('devnet', 'tx', 'not a signature'), ExplorerUrlError);
  assert.throws(() => buildExplorerUrl('devnet', 'tx', ADDR), ExplorerUrlError, 'address is too short for a signature');
  assert.throws(() => buildExplorerUrl('devnet', 'address', SIG), ExplorerUrlError, 'signature is too long for an address');
  assert.throws(() => buildExplorerUrl('devnet', 'tx', `${SIG}/../x`), ExplorerUrlError);
  assert.throws(() => buildExplorerUrl('devnet', 'tx', SIG, { baseUrl: 'http://evil.example' }), ExplorerUrlError);
  assert.throws(() => buildExplorerUrl('localnet', 'tx', SIG, { localnetRpcUrl: 'javascript:alert(1)' }), ExplorerUrlError);
});

test('every reason code has a definition, a title, and text that renders without params', () => {
  for (const code of Object.values(ReasonCodes)) {
    const d = REASON_DEFINITIONS[code];
    assert.ok(d.title.length > 0, code);
    const text = describeReason(code);
    assert.ok(text.length > 10, code);
    assert.ok(!text.includes('undefined') && !text.includes('NaN'), `${code}: ${text}`);
  }
  assert.equal(Object.keys(REASON_DEFINITIONS).length, Object.keys(ReasonCodes).length);
  assert.equal(isReasonCode('MANDATE_REVOKED'), true);
  assert.equal(isReasonCode('toString'), false);
  assert.equal(isReasonCode(42), false);
});

test('reason text is built from machine params', () => {
  const text = describeReason('PER_PAYMENT_LIMIT_EXCEEDED', { amountMinor: '3500000000', perPaymentLimitMinor: '2500000000', currency: 'USDC' });
  assert.equal(text, 'The payment of 3,500.00 USDC exceeds the per-payment limit of 2,500.00 USDC.');
  const ex = explainDecision('rejected', ['MANDATE_REVOKED' as ReasonCode], { mandateId: 'm1' });
  assert.equal(ex.headline, 'Rejected: Mandate revoked');
  assert.equal(explainDecision('approved', ['APPROVED_WITHIN_MANDATE'], {}).headline, 'Approved');
});

test('salted commitments: deterministic, salt-dependent, verifiable, salt length enforced', () => {
  const salt = 'a-long-enough-test-salt';
  const c = createSaltedCommitment('clause text', salt);
  assert.match(c, /^[0-9a-f]{64}$/);
  assert.equal(c, createSaltedCommitment('clause text', salt));
  assert.notEqual(c, createSaltedCommitment('clause text', salt + '2'));
  assert.equal(verifyCommitment(c, 'clause text', salt), true);
  assert.equal(verifyCommitment(c, 'other text', salt), false);
  assert.throws(() => createSaltedCommitment('x', 'short'));
  assert.match(generateSalt(), /^[0-9a-f]{32}$/);
});

test('redaction helpers', async () => {
  assert.equal(maskIdentifier(SIG), `${SIG.slice(0, 4)}…${SIG.slice(-4)}`);
  assert.equal(maskIdentifier('short'), 'short');
  assert.deepEqual(redactValue({ a: 'x', memo: 'secret memo', n: [{ memo: 'y', keep: 1 }] }, new Set(['memo'])), { a: 'x', memo: REDACTED, n: [{ memo: REDACTED, keep: 1 }] });

  const f = await buildFixture('success');
  const clause = f.events.find((e) => e.type === 'EvidenceClauseLinked');
  assert.ok(clause);
  const pub = redactEvent(clause, 'public');
  assert.equal((pub.payload as { excerptPreview: string }).excerptPreview, REDACTED);
  assert.equal(pub.originalHash, clause.hash);
  assert.equal(pub.redacted, true);
  assert.equal((pub.payload as { excerptCommitment: string }).excerptCommitment, (clause.payload as { excerptCommitment: string }).excerptCommitment, 'commitment kept');
  assert.ok((clause.payload as { excerptPreview?: string }).excerptPreview?.includes('Customer'), 'original untouched');
  assert.ok(redactedKeysFor('public').has('memo') && !redactedKeysFor('auditor').has('memo'));

  const intent = f.events.find((e) => e.type === 'SpendIntentSubmitted');
  assert.ok(intent);
  assert.equal((redactEvent(intent, 'public').payload as { memo: string }).memo, REDACTED);
  assert.equal((redactEvent(intent, 'auditor').payload as { memo: string }).memo, 'Reserve GPU hours for batch 42 (synthetic)');
});

test('secret guard flags key names only and never returns values', () => {
  const hits = findSecretFields({ ok: 1, nested: [{ privateKey: 'VALUE-1' }], x: { Authorization: 'Bearer abc', seed_phrase: 'w' } });
  assert.deepEqual(hits.sort(), ['$.nested[0].privateKey', '$.x.Authorization', '$.x.seed_phrase'].sort());
  assert.ok(!JSON.stringify(hits).includes('VALUE-1'));
  assert.deepEqual(findSecretFields({ amountMinor: '5', signature: SIG, onchainAccount: ADDR }), []);
});

test('no fixture event contains secret-looking fields or key material', async () => {
  for (const name of FIXTURE_NAMES) {
    const f = await buildFixture(name);
    for (const e of f.events) assert.deepEqual(findSecretFields(e), [], `${name}/${e.eventId}`);
  }
});

test('source tree has no secrets, env access, network calls or NEXT_PUBLIC usage', () => {
  const dir = join(import.meta.dirname, '..', '..', 'source');
  const banned = [/process\.env/, /NEXT_PUBLIC/, /\bfetch\(/, /require\(['"]https?['"]\)/, /BEGIN [A-Z ]*PRIVATE KEY/, /sk-[A-Za-z0-9]{20,}/, /\bMath\.random\b/, /Keypair/];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
    const text = readFileSync(join(dir, file), 'utf8');
    for (const re of banned) assert.ok(!re.test(text), `${file} matches ${String(re)}`);
  }
});
