import foodDbRaw from "../data/foodDb.json";
import {
  CanonicalFood,
  ConfidenceBand,
  ExtractedFoodItem,
  MatchedFoodItem,
} from "../types";
import { logEvent } from "./logger";

const foodDb = foodDbRaw as CanonicalFood[];

const HIGH_THRESHOLD = 0.8;
const MEDIUM_THRESHOLD = 0.55;

function normalize(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[\u200c\u200f\u064b-\u065f]/g, "") // strip Persian ZWNJ/diacritics
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ");
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0),
  );
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[m][n];
}

/** Similarity in [0,1]: 1 = identical, blends edit-distance with token overlap
 * so partial matches like "grilled chicken" vs "chicken breast, grilled" score well. */
function stringSimilarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  const editSim = 1 - levenshtein(na, nb) / Math.max(na.length, nb.length);

  const tokensA = new Set(na.split(" "));
  const tokensB = new Set(nb.split(" "));
  const overlap = [...tokensA].filter((t) => tokensB.has(t)).length;
  const tokenSim = overlap / Math.max(tokensA.size, tokensB.size);

  return Math.max(editSim, tokenSim, 0.6 * editSim + 0.4 * tokenSim);
}

function scoreFoodAgainstQuery(food: CanonicalFood, query: string): number {
  const candidates = [food.canonicalName, ...food.aliases];
  return Math.max(...candidates.map((c) => stringSimilarity(c, query)));
}

function confidenceBand(score: number): ConfidenceBand {
  if (score >= HIGH_THRESHOLD) return "high";
  if (score >= MEDIUM_THRESHOLD) return "medium";
  return "low";
}

function resolveGrams(item: ExtractedFoodItem, food: CanonicalFood): number {
  // If the LLM gave a numeric quantity + a unit that matches the food's default
  // unit family, use it directly. Otherwise fall back to one default serving.
  // This is intentionally conservative: better to under/over-estimate a known
  // amount than to compound LLM-guessed units with LLM-guessed nutrition.
  if (item.quantity && item.unit) {
    const unit = item.unit.toLowerCase();
    if (unit === "gram" || unit === "g" || unit === "grams")
      return item.quantity;
    if (unit === food.defaultUnit || unit === food.defaultUnit + "s") {
      return item.quantity * food.gramsPerUnit;
    }
  }
  if (item.quantity && !item.unit) {
    // e.g. "2 apples" with foodGuess unit implied by the food itself
    return item.quantity * food.gramsPerUnit;
  }
  return food.gramsPerUnit; // one default serving
}

export function matchExtractedItem(
  item: ExtractedFoodItem,
  traceId: string,
): MatchedFoodItem {
  const query = item.foodGuess || item.rawPhrase;
  const scored = foodDb
    .map((food) => ({ food, score: scoreFoodAgainstQuery(food, query) }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  const confidence = best ? confidenceBand(best.score) : "low";
  const needsUserConfirmation = confidence !== "high";

  const matchedFood = best && best.score >= MEDIUM_THRESHOLD ? best.food : null;
  const estimatedGrams = matchedFood ? resolveGrams(item, matchedFood) : 0;
  const nutrition = matchedFood
    ? {
        kcal: Math.round(
          (matchedFood.nutritionPer100g.kcal * estimatedGrams) / 100,
        ),
        proteinG: Math.round(
          (matchedFood.nutritionPer100g.proteinG * estimatedGrams) / 100,
        ),
        carbsG: Math.round(
          (matchedFood.nutritionPer100g.carbsG * estimatedGrams) / 100,
        ),
        fatG: Math.round(
          (matchedFood.nutritionPer100g.fatG * estimatedGrams) / 100,
        ),
      }
    : null;

  logEvent({
    traceId,
    stage: "match",
    payload: {
      query,
      topMatch: matchedFood?.canonicalName ?? null,
      score: best?.score ?? 0,
      confidence,
    },
  });

  return {
    extracted: item,
    matchedFood,
    matchScore: best?.score ?? 0,
    confidence,
    estimatedGrams,
    nutrition,
    needsUserConfirmation,
    candidateAlternatives: scored
      .slice(0, 4)
      .map((s) => ({ food: s.food, score: s.score })),
  };
}

export function matchAllItems(
  items: ExtractedFoodItem[],
  traceId: string,
): MatchedFoodItem[] {
  return items.map((item) => matchExtractedItem(item, traceId));
}
