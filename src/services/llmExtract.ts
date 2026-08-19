import { ExtractedFoodItem, LLMExtractionResult } from "../types";
import { logEvent, withStageLogging } from "./logger";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "";
const MAX_RETRIES = 2;
const TIMEOUT_MS = 15000;

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
    throw new Error("Server response not an object");
  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.items))
    throw new Error("Server response missing items[]");
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

/**
 * Calls our own backend (server/) instead of Gemini directly. The backend
 * holds the API key, so nothing secret ships inside the app bundle. The
 * traceId doubles as the Idempotency-Key: if this exact call is retried
 * below, the server returns the cached result instead of re-billing the LLM.
 */
async function callBackendOnce(
  text: string,
  traceId: string,
): Promise<LLMExtractionResult> {
  const response = await withTimeout(
    fetch(`${API_BASE_URL}/api/extract/text`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": traceId,
        "x-trace-id": traceId,
      },
      body: JSON.stringify({ text }),
    }),
    TIMEOUT_MS,
  );

  if (!response.ok) {
    throw new Error(
      `Backend error ${response.status}: ${await response.text()}`,
    );
  }

  return validateShape(await response.json());
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
          const result = await callBackendOnce(rawText, traceId);
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
