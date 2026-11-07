export interface TwinInput {
  cashMinor: bigint;
  monthlyRevenueMinor: bigint;
  monthlyBurnMinor: bigint;
  existingCommittedMinor: bigint;
  proposedMonthlyObligationMinor: bigint;
  proposedPeriods: number;
  reserveMonths: number;
}

export interface TwinResult {
  monthlyNetBurnMinor: bigint;
  runwayBeforeMonths: number | null;
  runwayAfterMonths: number | null;
  contractuallyCommittedMinor: bigint;
  safeToDeployMinor: bigint;
  assumptions: TwinInput;
}

export function simulateTwin(input: TwinInput): TwinResult {
  for (const [name, value] of Object.entries(input)) {
    if (typeof value === "bigint" && value < 0n) throw new Error(`${name} cannot be negative`);
  }
  const beforeBurn = input.monthlyBurnMinor - input.monthlyRevenueMinor;
  const afterBurn = beforeBurn + input.proposedMonthlyObligationMinor;
  const proposedCommitment = input.proposedMonthlyObligationMinor * BigInt(input.proposedPeriods);
  const committed = input.existingCommittedMinor + proposedCommitment;
  const reserve = afterBurn > 0n ? afterBurn * BigInt(input.reserveMonths) : 0n;
  return {
    monthlyNetBurnMinor: afterBurn,
    runwayBeforeMonths: runway(input.cashMinor, beforeBurn),
    runwayAfterMonths: runway(input.cashMinor, afterBurn),
    contractuallyCommittedMinor: committed,
    safeToDeployMinor: max(0n, input.cashMinor - committed - reserve),
    assumptions: input,
  };
}

function runway(cash: bigint, monthlyBurn: bigint): number | null {
  if (monthlyBurn <= 0n) return null;
  return Number(cash) / Number(monthlyBurn);
}

function max(a: bigint, b: bigint) { return a > b ? a : b; }

// Full scenario engine. The original simulateTwin API remains stable for the
// guided UI while richer product surfaces adopt these validated projections.
export { runTwin, computeTwin, buildComparison } from "./advanced/engine";
export { validateTwinInput } from "./advanced/validate";
export { buildScenarios, DEFAULT_BASE_ASSUMPTIONS } from "./advanced/scenarios";
export { goldenDemoInput } from "./advanced/fixtures/golden-demo";
export { formatMonthsX100, comparableRunwayX100 } from "./advanced/facts";

