import { validateProposal, type ExtractionResult } from "./flux-contracts";

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

export async function extractWithGroq(contractText: string): Promise<ExtractionResult> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY is not configured");

  const response = await fetch(GROQ_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || "openai/gpt-oss-20b",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "You extract proposed commercial obligations. Never invent missing terms. Return JSON only. All money values must be decimal strings in the currency's minor unit. Evidence excerpts must be short exact excerpts from the supplied text. The proposal is never an approval.",
        },
        {
          role: "user",
          content: `${schemaInstruction}\n\nCONTRACT TEXT:\n${contractText}`,
        },
      ],
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    throw new Error(`Groq request failed with status ${response.status}`);
  }

  const payload: unknown = await response.json();
  const content = readContent(payload);
  const parsed: unknown = JSON.parse(content);

  return {
    proposal: validateProposal(parsed),
    mode: "live",
    provider: "groq",
    requiresHumanApproval: true,
  };
}

const schemaInstruction = `Return exactly one object with these fields:
{
  "contractTitle": string,
  "counterparty": string,
  "currency": uppercase currency code,
  "totalAmountMinor": decimal string,
  "paymentAmountMinor": decimal string,
  "intervalDays": integer,
  "termMonths": integer,
  "startsAt": "YYYY-MM-DD",
  "expiresAt": "YYYY-MM-DD",
  "renewalRequiresApproval": boolean,
  "evidence": [{ "page": integer, "clause": string, "excerpt": string, "confidenceBps": integer 0-10000 }]
}`;

function readContent(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) throw new Error("Groq response is malformed");
  const first = payload.choices[0];
  if (!isRecord(first) || !isRecord(first.message) || typeof first.message.content !== "string") {
    throw new Error("Groq response does not contain message content");
  }
  return first.message.content;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
