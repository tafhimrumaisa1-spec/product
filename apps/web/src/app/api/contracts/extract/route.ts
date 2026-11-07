import { deterministicReplay } from "@/lib/flux-contracts";
import { extractWithGroq } from "@/lib/groq";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET() {
  return Response.json({
    provider: process.env.AI_PROVIDER || "replay",
    configured: Boolean(process.env.GROQ_API_KEY),
    accepts: "synthetic contract text only",
  });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be JSON" }, { status: 400 });
  }

  if (!isRecord(body)) return Response.json({ error: "Request body must be an object" }, { status: 400 });
  const mode = body.mode === "live" ? "live" : "replay";
  const contractText = typeof body.contractText === "string" ? body.contractText.trim() : "";

  if (mode === "replay") return Response.json(deterministicReplay());
  if (contractText.length < 80 || contractText.length > 20_000) {
    return Response.json({ error: "contractText must contain 80-20,000 characters" }, { status: 400 });
  }

  try {
    return Response.json(await extractWithGroq(contractText));
  } catch (error) {
    const warning = error instanceof Error ? error.message : "Live extraction failed";
    return Response.json(deterministicReplay(warning), { status: 200 });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
