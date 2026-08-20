const MODEL = "gemini-3.6-flash";
const TIMEOUT_MS = 20000;
const MAX_RETRIES = 2;

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

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms),
    ),
  ]);
}

function validateShape(parsed) {
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("LLM output not an object");
  }
  if (!Array.isArray(parsed.items)) throw new Error("LLM output missing items[]");
  const items = parsed.items.map((r, i) => {
    if (typeof r.rawPhrase !== "string" || typeof r.foodGuess !== "string") {
      throw new Error(`item ${i} missing required string fields`);
    }
    return {
      rawPhrase: r.rawPhrase,
      foodGuess: r.foodGuess,
      quantity: typeof r.quantity === "number" ? r.quantity : null,
      unit: typeof r.unit === "string" ? r.unit : null,
      qualifiers: Array.isArray(r.qualifiers) ? r.qualifiers : [],
    };
  });
  return {
    items,
    languageDetected:
      typeof parsed.languageDetected === "string" ? parsed.languageDetected : "unknown",
    modelNotes: typeof parsed.modelNotes === "string" ? parsed.modelNotes : null,
    description:
      typeof parsed.description === "string"
        ? parsed.description
        : "Here's what I found in your photo.",
  };
}

async function callGeminiOnce(base64Image, mimeType) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set on the server");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
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
          temperature: 0.2,
          responseMimeType: "application/json",
        },
      }),
    }),
    TIMEOUT_MS,
  );

  if (!response.ok) {
    throw new Error(`Gemini API error ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  const textOut = data && data.candidates && data.candidates[0] &&
    data.candidates[0].content && data.candidates[0].content.parts &&
    data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
  if (!textOut) throw new Error("Gemini response had no text content");

  const cleaned = textOut.replace(/```json|```/g, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error("Gemini output was not valid JSON");
  }
  return validateShape(parsed);
}

async function extractFoodItemsFromPhoto(base64Image, mimeType) {
  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await callGeminiOnce(base64Image, mimeType);
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 300 * 2 ** attempt));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Photo extraction failed");
}

module.exports = { extractFoodItemsFromPhoto };
