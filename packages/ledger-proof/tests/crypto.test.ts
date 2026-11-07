import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { CanonicalizationError, MoneyError, canonicalJson, formatAmount, parseMinor, parseSignedMinor, sha256Hex, toMinor } from '../source/index.js';

test('sha256Hex matches node:crypto across padding boundaries and unicode', () => {
  const inputs = ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(63), 'a'.repeat(64), 'a'.repeat(65), 'x'.repeat(1000), 'héllo wörld ✓ 𝄞'];
  for (const s of inputs) assert.equal(sha256Hex(s), createHash('sha256').update(s, 'utf8').digest('hex'), `input length ${s.length}`);
});

test('sha256Hex known vector', () => {
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('canonicalJson sorts keys, drops undefined, rejects non-JSON', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [1, undefined], c: 'x' }, z: undefined }), '{"a":{"c":"x","d":[1,null]},"b":1}');
  assert.throws(() => canonicalJson({ n: Number.NaN }), CanonicalizationError);
  assert.throws(() => canonicalJson({ n: 1n }), CanonicalizationError);
  const cyc: Record<string, unknown> = {}; cyc['self'] = cyc;
  assert.throws(() => canonicalJson(cyc), CanonicalizationError);
});

test('money parsing is strict and formatting is exact', () => {
  assert.equal(parseMinor('1000000'), 1_000_000n);
  for (const bad of ['-1', '1.5', '01', '', '1e6', ' 1']) assert.throws(() => parseMinor(bad), MoneyError, bad);
  assert.throws(() => parseMinor(5 as unknown as string), MoneyError);
  assert.equal(parseSignedMinor('-800'), -800n);
  assert.equal(formatAmount(1_000_000_000n), '1,000.00 USDC');
  assert.equal(formatAmount(1_234_567n), '1.234567 USDC');
  assert.equal(formatAmount(-800_000_000n), '-800.00 USDC');
  assert.equal(toMinor('2500'), '2500000000');
  assert.equal(toMinor('0.000001'), '1');
  assert.throws(() => toMinor('0.0000001'), MoneyError);
});
