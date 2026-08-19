// ---------------------------------------------------------------------------
// Core domain types for the meal logging pipeline.
// Pipeline: raw text -> LLM extraction -> canonical food matching -> nutrition
// ---------------------------------------------------------------------------

/** What the LLM is allowed to output. Deliberately NOT nutrition numbers —
 * the LLM extracts structure, it never invents calories/macros. */
export interface ExtractedFoodItem {
  rawPhrase: string; // the exact span of user text this came from, e.g.
  foodGuess: string; // normalized food name guess, e.g. "white rice, cooked"
  quantity: number | null; // numeric quantity if stated, else null
  unit: string | null; // "plate" | "cup" | "gram" | "piece" | null if unstated
  qualifiers: string[]; // e.g. ["grilled", "no oil", "large"]
}

export interface LLMExtractionResult {
  items: ExtractedFoodItem[];
  languageDetected: string;
  modelNotes: string | null; // LLM's own flag of ambiguity, not used as ground truth
}

/** Same shape as text extraction, plus a short natural-language description
 * of the plate — this is the "what the AI sees" blurb shown to the user. */
export interface VisionExtractionResult extends LLMExtractionResult {
  description: string;
}

/** A row in our canonical food database. */
export interface CanonicalFood {
  id: string;
  canonicalName: string;
  aliases: string[]; // includes Persian + English colloquial names
  defaultUnit: string; // "gram" | "piece" | "cup" | "plate"
  gramsPerUnit: number; // conversion factor for defaultUnit -> grams
  nutritionPer100g: {
    kcal: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
  };
  category: string;
}

export type ConfidenceBand = "high" | "medium" | "low";

export interface MatchedFoodItem {
  extracted: ExtractedFoodItem;
  matchedFood: CanonicalFood | null;
  matchScore: number; // 0..1 similarity score from the matcher
  confidence: ConfidenceBand;
  estimatedGrams: number;
  nutrition: {
    kcal: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
  } | null;
  needsUserConfirmation: boolean;
  candidateAlternatives: { food: CanonicalFood; score: number }[]; // for disambiguation UI
}

export interface MealLogEntry {
  id: string;
  createdAt: string; // ISO timestamp
  rawInput: string;
  items: MatchedFoodItem[];
  totalNutrition: {
    kcal: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
  };
  userCorrected: boolean; // true if any item was manually edited/reassigned
  traceId: string; // ties this entry back to the structured logs for debugging
  source: "text" | "photo"; // how this entry was logged
  imageUri?: string; // local URI of the captured photo, if source === "photo"
  aiDescription?: string; // AI's short description of the plate, if source === "photo"
}

/** Structured event shape written by services/logger.ts.
 * This is our minimal "observability" surface. */
export interface PipelineLogEvent {
  traceId: string;
  stage:
    | "llm_extract"
    | "vision_extract"
    | "match"
    | "nutrition_calc"
    | "user_correction"
    | "error";
  timestamp: string;
  durationMs?: number;
  payload: Record<string, unknown>;
}

export type RootStackParamList = {
  LogMeal: undefined;
  Results: { entry: MealLogEntry };
  History: undefined;
};
