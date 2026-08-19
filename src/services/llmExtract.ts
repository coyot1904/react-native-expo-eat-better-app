import { ExtractedFoodItem, LLMExtractionResult } from "../types";
import { logEvent, withStageLogging } from "./logger";

const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY ?? "";
const MODEL = "gemini-2.5-flash";
const MAX_RETRIES = 2;
const TIMEOUT_MS = 15000;

const SYSTEM_PROMPT = `You are a food-text parser. Your ONLY job is to extract structured food mentions from a user's free-text meal description (which may be in Persian, English, or mixed).

STRICT RULES:
- Do NOT output nutrition numbers (no calories, no macros). You are a text parser, not a nutrition database.
- Do NOT invent foods that are not mentioned or strongly implied.
- If quantity or unit is not stated, use null — do not guess a number.
- Split compound meals into separate items (e.g. "rice with grilled chicken" -> two items).
- Preserve the exact source phrase for each item in rawPhrase, in the original language.
- If the input is ambiguous or you are unsure about a food's identity, still extract it with your best guess in foodGuess, and add a note in modelNotes — do not silently drop it.

Respond with ONLY valid JSON matching this exact shape, no markdown fences, no preamble:
{
  "items": [
    { "rawPhrase": string, "foodGuess": string, "quantity": number | null, "unit": string | null, "qualifiers": string[] }
  ],
  "languageDetected": string,
  "modelNotes": string | null
}`;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms),
    ),
  ]);
}

function validateShape(parsed: unknown): LLMExtractionResult {
  if (typeof parsed !== "object" || parsed === null)
    throw new Error("LLM output not an object");
  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.items)) throw new Error("LLM output missing items[]");
  const items: ExtractedFoodItem[] = obj.items.map(
    (raw: unknown, i: number) => {
      const r = raw as Record<string, unknown>;
      if (typeof r.rawPhrase !== "string" || typeof r.foodGuess !== "string") {
        throw new Error(`item ${i} missing required string fields`);
      }
      return {
        rawPhrase: r.rawPhrase,
        foodGuess: r.foodGuess,
        quantity: typeof r.quantity === "number" ? r.quantity : null,
        unit: typeof r.unit === "string" ? r.unit : null,
        qualifiers: Array.isArray(r.qualifiers)
          ? (r.qualifiers as string[])
          : [],
      };
    },
  );
  return {
    items,
    languageDetected:
      typeof obj.languageDetected === "string"
        ? obj.languageDetected
        : "unknown",
    modelNotes: typeof obj.modelNotes === "string" ? obj.modelNotes : null,
  };
}

async function callLLMOnce(text: string): Promise<LLMExtractionResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const response = await withTimeout(
    fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text }] }],
        generationConfig: {
          temperature: 0.2, // low temperature: we want consistent extraction, not creative variety
          responseMimeType: "application/json", // Gemini native JSON-mode, skips markdown-fence stripping
        },
      }),
    }),
    TIMEOUT_MS,
  );

  if (!response.ok) {
    throw new Error(
      `LLM API error ${response.status}: ${await response.text()}`,
    );
  }

  const data = await response.json();
  const textOut: string | undefined =
    data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!textOut) throw new Error("LLM response had no text content");

  const cleaned = textOut.replace(/```json|```/g, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error("LLM output was not valid JSON");
  }
  return validateShape(parsed);
}

export async function extractFoodItems(
  rawText: string,
  traceId: string,
): Promise<LLMExtractionResult> {
  return withStageLogging(
    traceId,
    "llm_extract",
    async () => {
      let lastError: unknown;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const result = await callLLMOnce(rawText);
          if (attempt > 0) {
            logEvent({
              traceId,
              stage: "llm_extract",
              payload: { retrySucceededOnAttempt: attempt },
            });
          }
          return result;
        } catch (err) {
          lastError = err;
          logEvent({
            traceId,
            stage: "llm_extract",
            payload: {
              attempt,
              retrying: attempt < MAX_RETRIES,
              error: String(err),
            },
          });
          if (attempt < MAX_RETRIES) {
            await new Promise((r) => setTimeout(r, 300 * 2 ** attempt)); // exponential backoff
          }
        }
      }
      throw lastError instanceof Error
        ? lastError
        : new Error("LLM extraction failed");
    },
    { rawTextLength: rawText.length },
  );
}
