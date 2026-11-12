import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateFacts } from "./facts-validation";
import { groundingCheck, roundHalfUp, type GroundingResult, type Interpretation } from "./grounding";

interface Fixtures {
  facts_samples: { name: string; facts: Record<string, unknown>; rule_based: Interpretation }[];
  grounding_cases: { name: string; interpretation: Interpretation; facts: Record<string, unknown>; expected: GroundingResult }[];
}
const fixtures = JSON.parse(readFileSync(new URL("./__fixtures__/llm-fixtures.json", import.meta.url), "utf8")) as Fixtures;

describe("roundHalfUp matches Python's Decimal ROUND_HALF_UP", () => {
  it.each([
    [13.75, 1, 13.8], [2.5, 0, 3], [-2.5, 0, -3], [1.005, 2, 1.01], [6072, -2, 6100],
    [5414.333, 0, 5414], [0.125, 2, 0.13], [13.84, 1, 13.8], [0, 1, 0],
  ])("roundHalfUp(%s, %s) = %s", (value, digits, expected) => {
    expect(roundHalfUp(value, digits)).toBe(expected);
  });
});

describe("TypeScript grounding check agrees with the Python engine", () => {
  it.each(fixtures.grounding_cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    expect(groundingCheck(c.interpretation, c.facts)).toEqual(c.expected);
  });
});

describe("facts validation accepts every facts document the engine produces", () => {
  it.each(fixtures.facts_samples.map((s) => [s.name, s] as const))("%s", (_name, s) => {
    const result = validateFacts(s.facts);
    expect(result.ok, result.ok ? "" : result.error).toBe(true);
  });
});
