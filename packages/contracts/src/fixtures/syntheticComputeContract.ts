import type { ContractDocument } from '../types.js';

/**
 * Synthetic golden-demo contract. Fictional parties, no real money.
 * Authoring note: straight ASCII quotes are used on purpose so span offsets are stable.
 */
export const SYNTHETIC_COMPUTE_CONTRACT_TEXT = `SYNTHETIC COMPUTE SERVICES AGREEMENT (FIXTURE - NOT A REAL CONTRACT)
Agreement ID: FX-SYN-2026-0001

1. Parties. This agreement is between Meridian Compute Ltd. ("Vendor") and Halcyon Robotics Inc. ("Customer").

2. Term. The term begins on 2026-01-01 and ends on 2026-06-30 (6 months).

3. Fees. Customer shall pay Vendor a total of USD 60,000.00 over the term.

4. Spending Cap. Charges in any calendar month shall not exceed USD 12,000.00.

5. Payment Schedule. Customer shall pay six installments of USD 10,000.00, due on the first day of each month from 2026-01-01 through 2026-06-01.

6. Renewal. This agreement renews automatically for successive 6-month terms unless either party gives 30 days' written notice of non-renewal.

7. Termination. Either party may terminate for convenience with 60 days' written notice.

8. Services. Vendor provides GPU compute capacity as described in Schedule A (omitted from this fixture).
`;

export const SYNTHETIC_COMPUTE_CONTRACT: ContractDocument = {
  contractId: 'FX-SYN-2026-0001',
  text: SYNTHETIC_COMPUTE_CONTRACT_TEXT,
};

/** A fixed 32-byte salt for tests/demos ONLY. Real runs must use `generateSalt()`. */
export const FIXTURE_SALT_HEX = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
