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
  modelNotes: string | null;
}

export interface VisionExtractionResult extends LLMExtractionResult {
  description: string;
}

export interface CanonicalFood {
  id: string;
  canonicalName: string;
  aliases: string[];
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
  candidateAlternatives: { food: CanonicalFood; score: number }[];
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
