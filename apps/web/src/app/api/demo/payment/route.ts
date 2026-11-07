import { parsePaymentScenario, runDemoPayment } from "@/lib/demo-pipeline";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be JSON" }, { status: 400 });
  }
  if (!isRecord(body)) return Response.json({ error: "Request body must be an object" }, { status: 400 });
  const scenario = parsePaymentScenario(body.scenario);
  if (!scenario) return Response.json({ error: "scenario must be authorized or over_cap" }, { status: 400 });
  return Response.json(await runDemoPayment(scenario));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
