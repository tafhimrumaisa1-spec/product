import { buildPublicDemoProof, parseProofScenario } from "@/lib/demo-pipeline";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const scenario = parseProofScenario(new URL(request.url).searchParams.get("scenario"));
  if (!scenario) return Response.json({ error: "scenario must be success or over_limit" }, { status: 400 });
  return Response.json(await buildPublicDemoProof(scenario));
}
