export const POLICY_OUTCOMES = ["allow", "deny", "require_human_approval"] as const;
export type PolicyOutcome = (typeof POLICY_OUTCOMES)[number];
