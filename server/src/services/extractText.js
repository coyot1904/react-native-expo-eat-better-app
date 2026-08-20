const MODEL = "gemini-3.6-flash";
const TIMEOUT_MS = 15000;
const MAX_RETRIES = 2;

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
  };
}

async function callGeminiOnce(text) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set on the server");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
  const response = await withTimeout(
    fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text }] }],
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

async function extractFoodItemsFromText(text) {
  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await callGeminiOnce(text);
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 300 * 2 ** attempt));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Text extraction failed");
}

module.exports = { extractFoodItemsFromText };
