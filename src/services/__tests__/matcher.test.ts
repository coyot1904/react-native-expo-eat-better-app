import { matchAllItems, matchExtractedItem } from "../matcher";
import { ExtractedFoodItem } from "../../types";

function item(overrides: Partial<ExtractedFoodItem> = {}): ExtractedFoodItem {
  return {
    rawPhrase: "",
    foodGuess: "",
    quantity: null,
    unit: null,
    qualifiers: [],
    ...overrides,
  };
}

const TRACE_ID = "test-trace";

describe("matchExtractedItem — confidence bands", () => {
  it("matches an exact canonical name with high confidence", () => {
    const result = matchExtractedItem(
      item({ rawPhrase: "white rice", foodGuess: "White rice, cooked" }),
      TRACE_ID,
    );
    expect(result.confidence).toBe("high");
    expect(result.matchedFood?.id).toBe("rice_white_cooked");
    expect(result.needsUserConfirmation).toBe(false);
  });

  it("matches a Turkish alias with high confidence", () => {
    const result = matchExtractedItem(
      item({ rawPhrase: "tavuk şiş", foodGuess: "tavuk şiş" }),
      TRACE_ID,
    );
    expect(result.matchedFood?.id).toBe("chicken_kebab");
    expect(result.confidence).toBe("high");
  });

  it("still matches through a typo, regardless of confidence tier", () => {
    const result = matchExtractedItem(
      item({ rawPhrase: "chiken breast", foodGuess: "chiken breast" }),
      TRACE_ID,
    );
    expect(result.matchedFood?.id).toBe("chicken_breast_grilled");
    expect(["high", "medium"]).toContain(result.confidence);
  });

  it("returns low confidence and no match for unrelated input", () => {
    const result = matchExtractedItem(
      item({ rawPhrase: "xyzzy nonsense", foodGuess: "xyzzy nonsense qwerty" }),
      TRACE_ID,
    );
    expect(result.confidence).toBe("low");
    expect(result.matchedFood).toBeNull();
    expect(result.nutrition).toBeNull();
    expect(result.needsUserConfirmation).toBe(true);
  });

  it("flags anything below 'high' as needing user confirmation", () => {
    const result = matchExtractedItem(
      item({ rawPhrase: "xyzzy nonsense", foodGuess: "xyzzy nonsense qwerty" }),
      TRACE_ID,
    );
    expect(result.needsUserConfirmation).toBe(true);
  });
});

describe("matchExtractedItem — portion + nutrition math", () => {
  it("uses an explicit gram quantity directly", () => {
    const result = matchExtractedItem(
      item({
        rawPhrase: "300g chicken breast",
        foodGuess: "chicken breast",
        quantity: 300,
        unit: "gram",
      }),
      TRACE_ID,
    );
    expect(result.estimatedGrams).toBe(300);
    // 165 kcal / 100g * 300g = 495
    expect(result.nutrition?.kcal).toBe(495);
    expect(result.nutrition?.proteinG).toBe(93); // 31 * 3
  });

  it("converts a quantity in the food's own default unit", () => {
    // chicken_kebab: defaultUnit "piece", gramsPerUnit 200
    const result = matchExtractedItem(
      item({
        rawPhrase: "2 tavuk şiş",
        foodGuess: "tavuk şiş",
        quantity: 2,
        unit: "piece",
      }),
      TRACE_ID,
    );
    expect(result.estimatedGrams).toBe(400);
    // 190 kcal / 100g * 400g = 760
    expect(result.nutrition?.kcal).toBe(760);
  });

  it("falls back to one default serving when quantity/unit are unstated", () => {
    const result = matchExtractedItem(
      item({ rawPhrase: "pirinç", foodGuess: "pirinç" }),
      TRACE_ID,
    );
    expect(result.estimatedGrams).toBe(158); // rice_white_cooked gramsPerUnit
  });

  it("does not invent grams for a mismatched unit (falls back to default serving)", () => {
    const result = matchExtractedItem(
      item({
        rawPhrase: "3 cups tavuk şiş",
        foodGuess: "tavuk şiş",
        quantity: 3,
        unit: "cup",
      }),
      TRACE_ID,
    );
    expect(result.estimatedGrams).toBe(200); // one default serving, not 3x anything
  });
});

describe("matchAllItems", () => {
  it("preserves order and length across multiple items", () => {
    const items = [
      item({ rawPhrase: "pirinç", foodGuess: "pirinç" }),
      item({ rawPhrase: "tavuk şiş", foodGuess: "tavuk şiş" }),
      item({ rawPhrase: "unknown thing", foodGuess: "unknown thing zzz" }),
    ];
    const results = matchAllItems(items, TRACE_ID);
    expect(results).toHaveLength(3);
    expect(results[0].matchedFood?.id).toBe("rice_white_cooked");
    expect(results[1].matchedFood?.id).toBe("chicken_kebab");
    expect(results[2].matchedFood).toBeNull();
  });

  it("returns an empty array for empty input", () => {
    expect(matchAllItems([], TRACE_ID)).toEqual([]);
  });
});
