import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AiExtractor, buildExtractionPrompt, parseAiExtractionOutput } from '../src/extract/ai.js';
import { extractWithRules } from '../src/extract/rules.js';
import { createReviewSession, approveObligation, sessionIssues } from '../src/review.js';
import { SYNTHETIC_COMPUTE_CONTRACT as DOC } from '../src/fixtures/syntheticComputeContract.js';
import { AT, HUMAN, unwrap } from './helpers.js';

const INFO = { name: 'ai:test', version: 'v', kind: 'ai' as const };
const goodJson = () => JSON.stringify({ obligations: extractWithRules(DOC).obligations });

test('prompt marks the contract as untrusted and contains no secrets-like fields', () => {
  const p = buildExtractionPrompt(DOC);
  assert.ok(p.includes('untrusted'));
  assert.ok(p.includes(DOC.text));
  assert.equal(/api[_-]?key|secret|private key|seed phrase/i.test(p), false);
});

test('valid model output (including fenced JSON) parses into a proposal marked as AI', () => {
  const fenced = '```json\n' + goodJson() + '\n```';
  const r = unwrap(parseAiExtractionOutput(fenced, DOC, INFO));
  assert.equal(r.obligations.length, 7);
  assert.equal(r.extractor.kind, 'ai');
});

test('malformed model output is an error, not a throw', () => {
  for (const bad of ['not json', '{}', '{"obligations":[{"terms":{"kind":"NOPE"},"evidence":[],"confidence":1}]}',
    '{"obligations":[{"terms":{"kind":"TOTAL_VALUE","total":{"amountMinor":"6000000","currency":"USD"}},"evidence":[],"confidence":1}]}',
    '{"obligations":[{"terms":{"kind":"PARTIES","vendor":"a","customer":"b"},"evidence":[],"confidence":7}]}']) {
    const r = parseAiExtractionOutput(bad, DOC, INFO);
    assert.equal(!r.ok && r.error.code, 'AI_OUTPUT_INVALID', bad);
  }
});

test('AiExtractor uses only the injected function and surfaces its failures', async () => {
  let seen = '';
  const ok = await new AiExtractor(async (p) => ((seen = p), goodJson()), 'stub').extract(DOC);
  assert.equal(ok.ok, true);
  assert.ok(seen.includes('FX-SYN-2026-0001'));
  const bad = await new AiExtractor(async () => { throw new Error('boom'); }, 'stub').extract(DOC);
  assert.equal(!bad.ok && bad.error.code, 'AI_OUTPUT_INVALID');
});

test('AI proposal with a fabricated quote enters review but cannot be approved', () => {
  const o = extractWithRules(DOC).obligations.map((x, i) =>
    i === 0 ? { ...x, evidence: [{ start: 0, end: 4, quote: 'FAKE' }] } : x);
  const proposal = unwrap(parseAiExtractionOutput(JSON.stringify({ obligations: o }), DOC, INFO));
  const s = unwrap(createReviewSession(proposal, DOC, AT));
  assert.equal(s.obligations[0]!.proposedBy.kind, 'ai');
  assert.ok(sessionIssues(s).some((i) => i.code === 'EVIDENCE_MISMATCH'));
  const r = approveObligation(s, s.obligations[0]!.id, 1, HUMAN, AT);
  assert.equal(!r.ok && r.error.code, 'BLOCKING_ISSUES');
});

test('AI wrong amount is caught by deterministic cross-checks', () => {
  const o = extractWithRules(DOC).obligations.map((x) =>
    x.terms.kind === 'TOTAL_VALUE' ? { ...x, terms: { kind: 'TOTAL_VALUE', total: { amountMinor: 600_000, currency: 'USD' } } } : x);
  const proposal = unwrap(parseAiExtractionOutput(JSON.stringify({ obligations: o }), DOC, INFO));
  const s = unwrap(createReviewSession(proposal, DOC, AT));
  assert.ok(sessionIssues(s).some((i) => i.code === 'SCHEDULE_TOTAL_MISMATCH'));
});

test('low-confidence proposals raise a warning but never auto-approve', () => {
  const o = extractWithRules(DOC).obligations.map((x) => ({ ...x, confidence: 0.3 }));
  const proposal = unwrap(parseAiExtractionOutput(JSON.stringify({ obligations: o }), DOC, INFO));
  const s = unwrap(createReviewSession(proposal, DOC, AT));
  assert.ok(sessionIssues(s).some((i) => i.code === 'LOW_CONFIDENCE' && i.severity === 'warning'));
  assert.ok(s.obligations.every((x) => x.status === 'PENDING'));
});
