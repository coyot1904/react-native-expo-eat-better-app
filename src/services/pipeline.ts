import { MatchedFoodItem, MealLogEntry } from "../types";
import { extractFoodItems } from "./llmExtract";
import { extractFoodItemsFromImage } from "./visionExtract";
import { matchAllItems } from "./matcher";
import { newTraceId, logEvent } from "./logger";

function sumNutrition(items: MatchedFoodItem[]) {
  return items.reduce(
    (acc, item) => {
      if (!item.nutrition) return acc;
      return {
        kcal: acc.kcal + item.nutrition.kcal,
        proteinG: acc.proteinG + item.nutrition.proteinG,
        carbsG: acc.carbsG + item.nutrition.carbsG,
        fatG: acc.fatG + item.nutrition.fatG,
      };
    },
    { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  );
}

export async function runMealLoggingPipeline(
  rawInput: string,
): Promise<MealLogEntry> {
  const traceId = newTraceId();
  logEvent({
    traceId,
    stage: "llm_extract",
    payload: { status: "started", rawInput },
  });

  const extraction = await extractFoodItems(rawInput, traceId);
  const matched = matchAllItems(extraction.items, traceId);

  const entry: MealLogEntry = {
    id: traceId,
    createdAt: new Date().toISOString(),
    rawInput,
    items: matched,
    totalNutrition: sumNutrition(matched),
    userCorrected: false,
    traceId,
    source: "text",
  };

  return entry;
}

export async function runPhotoMealLoggingPipeline(
  base64Image: string,
  mimeType: string,
  imageUri: string,
): Promise<MealLogEntry> {
  const traceId = newTraceId();
  logEvent({
    traceId,
    stage: "vision_extract",
    payload: { status: "started" },
  });

  const extraction = await extractFoodItemsFromImage(
    base64Image,
    mimeType,
    traceId,
  );
  const matched = matchAllItems(extraction.items, traceId);

  const entry: MealLogEntry = {
    id: traceId,
    createdAt: new Date().toISOString(),
    rawInput: extraction.description,
    items: matched,
    totalNutrition: sumNutrition(matched),
    userCorrected: false,
    traceId,
    source: "photo",
    imageUri,
    aiDescription: extraction.description,
  };

  return entry;
}
