import { ExtractedFoodItem, VisionExtractionResult } from "../types";
import { logEvent, withStageLogging } from "./logger";

const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY ?? "";
const MODEL = "gemini-2.5-flash";
const MAX_RETRIES = 2;
const TIMEOUT_MS = 20000; // vision calls run a bit slower than text-only

const SYSTEM_PROMPT = `You are a food-photo analyst. Look at the photo of a meal and identify what's on the plate.

STRICT RULES:
- Do NOT output nutrition numbers (no calories, no macros). You identify foods, you don't calculate nutrition.
- Only report foods you can actually see. Do not invent items that aren't visible.
- Estimate a portion size in "unit" + "quantity" from visual cues if you reasonably can (e.g. "1 plate", "2 pieces"); if you can't tell, use null — do not guess a precise number.
- If multiple distinct foods are visible, split them into separate items (e.g. rice and grilled chicken on the same plate -> two items).
- Note any qualifiers you can see (e.g. "grilled", "fried", "with sauce").
- If the photo is blurry, dark, or doesn't clearly show food, still do your best and say so in modelNotes — do not refuse.
- Write "description" as one short, friendly sentence describing the plate as a whole, the way you'd describe it to the person who took the photo.

Respond with ONLY valid JSON matching this exact shape, no markdown fences, no preamble:
{
  "items": [
    { "rawPhrase": string, "foodGuess": string, "quantity": number | null, "unit": string | null, "qualifiers": string[] }
  ],
  "languageDetected": string,
  "modelNotes": string | null,
  "description": string
}`;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms),
    ),
  ]);
}

function validateShape(parsed: unknown): VisionExtractionResult {
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
    description:
      typeof obj.description === "string"
        ? obj.description
        : "Here's what I found in your photo.",
  };
}

async function callLLMOnce(
  base64Image: string,
  mimeType: string,
): Promise<VisionExtractionResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const response = await withTimeout(
    fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType, data: base64Image } },
              { text: "What food is in this photo?" },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.2, // low temperature: consistent identification, not creative variety
          responseMimeType: "application/json",
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

/**
 * Same retry/timeout/logging shape as extractFoodItems in llmExtract.ts,
 * but takes a base64-encoded photo instead of raw text.
 */
export async function extractFoodItemsFromImage(
  base64Image: string,
  mimeType: string,
  traceId: string,
): Promise<VisionExtractionResult> {
  return withStageLogging(
    traceId,
    "vision_extract",
    async () => {
      let lastError: unknown;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const result = await callLLMOnce(base64Image, mimeType);
          if (attempt > 0) {
            logEvent({
              traceId,
              stage: "vision_extract",
              payload: { retrySucceededOnAttempt: attempt },
            });
          }
          return result;
        } catch (err) {
          lastError = err;
          logEvent({
            traceId,
            stage: "vision_extract",
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
        : new Error("Vision extraction failed");
    },
    { imageSizeBytes: Math.round((base64Image.length * 3) / 4) },
  );
}
