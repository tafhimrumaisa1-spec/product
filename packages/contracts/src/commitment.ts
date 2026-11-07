import { randomBytes } from 'node:crypto';
import { canonicalJson, sha256Hex } from './canonical.js';
import {
  ALL_OBLIGATION_KINDS,
  err,
  ok,
  type ApprovedObligation,
  type ApprovedObligationSet,
  type Commitment,
  type Result,
} from './types.js';

export const COMMITMENT_DOMAIN = 'fluxcontracts/approved-set/v1';

/** 32 random bytes as 64 hex chars. The caller must keep it private (it is the reveal key). */
export function generateSalt(): string {
  return randomBytes(32).toString('hex');
}

export const isValidSalt = (s: string): boolean => /^[0-9a-fA-F]{64}$/.test(s);

/**
 * Salted commitment over the approved terms.
 *   value = sha256( domain \n salt \n canonicalJson({contractId, documentSha256, terms[]}) )
 * Only `value` is meant to leave the private system (e.g. go on-chain). The contract
 * text and the salt never do, so the value reveals nothing about the terms on its own.
 */
export function computeCommitment(
  contractId: string,
  documentSha256: string,
  obligations: readonly ApprovedObligation[],
  saltHex: string,
): Result<Commitment> {
  if (!isValidSalt(saltHex)) return err('INVALID_SALT', 'salt must be 32 bytes as 64 hex characters');
  const ordered = [...obligations].sort(
    (a, b) => ALL_OBLIGATION_KINDS.indexOf(a.kind) - ALL_OBLIGATION_KINDS.indexOf(b.kind),
  );
  const payload = canonicalJson({
    contractId,
    documentSha256,
    terms: ordered.map((o) => ({ kind: o.kind, revision: o.revision, terms: o.terms })),
  });
  return ok({
    algorithm: 'sha256',
    domain: COMMITMENT_DOMAIN,
    value: sha256Hex(`${COMMITMENT_DOMAIN}\n${saltHex.toLowerCase()}\n${payload}`),
  });
}

/** Recompute the commitment from an approved set and its salt. */
export function verifyCommitment(set: ApprovedObligationSet, saltHex: string): boolean {
  const c = computeCommitment(set.contractId, set.documentSha256, set.obligations, saltHex);
  return c.ok && c.value.value === set.commitment.value;
}
