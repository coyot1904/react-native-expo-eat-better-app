import {
  runMealLoggingPipeline,
  runPhotoMealLoggingPipeline,
} from "../pipeline";

jest.mock("../llmExtract", () => ({
  extractFoodItems: jest.fn(),
}));
jest.mock("../visionExtract", () => ({
  extractFoodItemsFromImage: jest.fn(),
}));

import { extractFoodItems } from "../llmExtract";
import { extractFoodItemsFromImage } from "../visionExtract";

const mockExtractFoodItems = extractFoodItems as jest.Mock;
const mockExtractFoodItemsFromImage = extractFoodItemsFromImage as jest.Mock;

describe("runMealLoggingPipeline", () => {
  it("sums nutrition correctly across multiple matched items", async () => {
    mockExtractFoodItems.mockResolvedValue({
      items: [
        {
          rawPhrase: "pirinç",
          foodGuess: "pirinç",
          quantity: null,
          unit: null,
          qualifiers: [],
        },
        {
          rawPhrase: "tavuk şiş",
          foodGuess: "tavuk şiş",
          quantity: null,
          unit: null,
          qualifiers: [],
        },
      ],
      languageDetected: "tr",
      modelNotes: null,
    });

    const entry = await runMealLoggingPipeline("bir tabak pirinç, tavuk şiş");

    // rice: 158g @ 130kcal/100g = 205 (rounded), kebab: 200g @ 190kcal/100g = 380
    expect(entry.totalNutrition.kcal).toBe(
      entry.items[0].nutrition!.kcal + entry.items[1].nutrition!.kcal,
    );
    expect(entry.items).toHaveLength(2);
    expect(entry.source).toBe("text");
    expect(entry.userCorrected).toBe(false);
    expect(entry.id).toBe(entry.traceId);
  });

  it("produces a zero-total entry when nothing is extracted", async () => {
    mockExtractFoodItems.mockResolvedValue({
      items: [],
      languageDetected: "en",
      modelNotes: "no food mentioned",
    });

    const entry = await runMealLoggingPipeline("just some water");

    expect(entry.items).toHaveLength(0);
    expect(entry.totalNutrition).toEqual({
      kcal: 0,
      proteinG: 0,
      carbsG: 0,
      fatG: 0,
    });
  });

  it("does not silently swallow unmatched items — they stay in the list with null nutrition", async () => {
    mockExtractFoodItems.mockResolvedValue({
      items: [
        {
          rawPhrase: "something weird",
          foodGuess: "something weird zzz",
          quantity: null,
          unit: null,
          qualifiers: [],
        },
      ],
      languageDetected: "en",
      modelNotes: null,
    });

    const entry = await runMealLoggingPipeline("something weird");

    expect(entry.items).toHaveLength(1);
    expect(entry.items[0].matchedFood).toBeNull();
    expect(entry.items[0].nutrition).toBeNull();
    expect(entry.totalNutrition.kcal).toBe(0); // unmatched items contribute nothing, not NaN
  });

  it("propagates extraction errors instead of returning a fake empty entry", async () => {
    mockExtractFoodItems.mockRejectedValue(new Error("backend unreachable"));
    await expect(runMealLoggingPipeline("anything")).rejects.toThrow(
      "backend unreachable",
    );
  });
});

describe("runPhotoMealLoggingPipeline", () => {
  it("tags the entry as photo-sourced and carries the image URI + AI description", async () => {
    mockExtractFoodItemsFromImage.mockResolvedValue({
      items: [
        {
          rawPhrase: "rice",
          foodGuess: "white rice",
          quantity: null,
          unit: null,
          qualifiers: [],
        },
      ],
      languageDetected: "en",
      modelNotes: null,
      description: "A plate of rice with grilled chicken.",
    });

    const entry = await runPhotoMealLoggingPipeline(
      "base64stub",
      "image/jpeg",
      "file:///tmp/photo.jpg",
    );

    expect(entry.source).toBe("photo");
    expect(entry.imageUri).toBe("file:///tmp/photo.jpg");
    expect(entry.aiDescription).toBe("A plate of rice with grilled chicken.");
    expect(entry.rawInput).toBe("A plate of rice with grilled chicken.");
  });
});
