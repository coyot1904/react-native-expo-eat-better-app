import { ExtractedFoodItem, VisionExtractionResult } from "../types";
import { logEvent, withStageLogging } from "./logger";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "";
const MAX_RETRIES = 2;
const TIMEOUT_MS = 20000; // vision calls run a bit slower than text-only

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
    description:
      typeof obj.description === "string"
        ? obj.description
        : "Here's what I found in your photo.",
  };
}

async function callBackendOnce(
  base64Image: string,
  mimeType: string,
  traceId: string,
): Promise<VisionExtractionResult> {
  const response = await withTimeout(
    fetch(`${API_BASE_URL}/api/extract/photo`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": traceId,
        "x-trace-id": traceId,
      },
      body: JSON.stringify({ imageBase64: base64Image, mimeType }),
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
          const result = await callBackendOnce(base64Image, mimeType, traceId);
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
            await new Promise((r) => setTimeout(r, 300 * 2 ** attempt));
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
