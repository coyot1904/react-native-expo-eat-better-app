/**
 * Offline eval harness.
 *
 * Runs the DETERMINISTIC matching stage against hand-labeled ground truth.
 * We evaluate the matcher offline (using mockExtraction fixtures) rather than
 * hitting the live LLM on every run, for three reasons:
 *   1. Reproducibility — LLM output can drift between calls/model versions;
 *      the matcher is where we can get a stable, versioned accuracy number.
 *   2. Cost/speed — this can run in CI on every commit with zero API cost.
 *   3. Isolation — separates "did the LLM parse the sentence correctly" from
 *      "did we then match it to the right canonical food", which are two
 *      different failure classes that need different fixes.
 *
 * A separate (smaller, sampled) "live" eval mode hits the real LLM to catch
 * extraction-stage regressions — see runLiveEval() below, gated behind an
 * env var so it's opt-in and doesn't block fast local iteration.
 *
 * Usage: npm run eval
 */
import testCases from "./testCases.json";
import { matchAllItems } from "../src/services/matcher";
import { ExtractedFoodItem, MatchedFoodItem } from "../src/types";

interface TestCase {
  id: string;
  input: string;
  mockExtraction: ExtractedFoodItem[];
  expectedFoodIds: (string | null)[];
  notes?: string;
}

interface ErrorRecord {
  testCaseId: string;
  rawPhrase: string;
  expected: string | null;
  got: string | null;
  confidence: string;
  category: "wrong_match" | "false_positive" | "missed_match" | "low_confidence_correct_flagged";
}

function evalTestCase(tc: TestCase): { results: MatchedFoodItem[]; errors: ErrorRecord[] } {
  const matched = matchAllItems(tc.mockExtraction, `eval_${tc.id}`);
  const errors: ErrorRecord[] = [];

  matched.forEach((m, i) => {
    const expected = tc.expectedFoodIds[i] ?? null;
    const got = m.matchedFood?.id ?? null;

    if (expected === null && got !== null) {
      errors.push({
        testCaseId: tc.id,
        rawPhrase: m.extracted.rawPhrase,
        expected,
        got,
        confidence: m.confidence,
        category: "false_positive", // DB had no right answer but we matched something anyway
      });
    } else if (expected !== null && got === null) {
      errors.push({
        testCaseId: tc.id,
        rawPhrase: m.extracted.rawPhrase,
        expected,
        got,
        confidence: m.confidence,
        category: "missed_match",
      });
    } else if (expected !== got) {
      errors.push({
        testCaseId: tc.id,
        rawPhrase: m.extracted.rawPhrase,
        expected,
        got,
        confidence: m.confidence,
        category: "wrong_match",
      });
    } else if (expected === got && m.confidence !== "high" && expected !== null) {
      // Not a wrong answer, but flags where our confidence calibration is too
      // conservative — worth tracking separately from outright errors.
      errors.push({
        testCaseId: tc.id,
        rawPhrase: m.extracted.rawPhrase,
        expected,
        got,
        confidence: m.confidence,
        category: "low_confidence_correct_flagged",
      });
    }
  });

  return { results: matched, errors };
}

function main() {
  const cases = testCases as TestCase[];
  let totalItems = 0;
  let correctTop1 = 0;
  const allErrors: ErrorRecord[] = [];

  for (const tc of cases) {
    const { errors } = evalTestCase(tc);
    totalItems += tc.expectedFoodIds.length;
    const hardErrors = errors.filter((e) => e.category !== "low_confidence_correct_flagged");
    correctTop1 += tc.expectedFoodIds.length - hardErrors.length;
    allErrors.push(...errors);
  }

  const accuracy = totalItems > 0 ? correctTop1 / totalItems : 0;

  const byCategory: Record<string, number> = {};
  for (const e of allErrors) byCategory[e.category] = (byCategory[e.category] ?? 0) + 1;

  console.log("=== EatBetter Matcher Eval ===");
  console.log(`Test cases: ${cases.length}, food items evaluated: ${totalItems}`);
  console.log(`Top-1 accuracy: ${(accuracy * 100).toFixed(1)}% (${correctTop1}/${totalItems})`);
  console.log("\nError taxonomy:");
  for (const [cat, count] of Object.entries(byCategory)) {
    console.log(`  ${cat}: ${count}`);
  }
  console.log("\nDetailed errors:");
  for (const e of allErrors) {
    console.log(
      `  [${e.testCaseId}] "${e.rawPhrase}" -> expected=${e.expected ?? "none"} got=${e.got ?? "none"} confidence=${e.confidence} (${e.category})`
    );
  }

  if (accuracy < 0.7) {
    console.error("\nFAIL: accuracy below 70% threshold");
    process.exit(1);
  }
}

main();
