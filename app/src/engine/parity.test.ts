import { describe, expect, it } from "vitest";
import { ARIMA_TOLERANCE, compareJson, DEFAULT_TOLERANCE } from "./parity";

describe("compareJson", () => {
  it("passes identical structures and counts compared numbers", () => {
    const value = { a: 1.5, b: [1, 2, { c: 3 }], s: "x", n: null, t: true };
    const report = compareJson(value, structuredClone(value));
    expect(report.pass).toBe(true);
    expect(report.compared).toBe(4);
    expect(report.maxDeviation).toBe(0);
  });

  it("uses relative deviation for large values and absolute below 1", () => {
    expect(compareJson({ x: 5000.001 }, { x: 5000 }).pass).toBe(true);                 // 2e-7 relative
    expect(compareJson({ x: 5000.1 }, { x: 5000 }).pass).toBe(false);                  // 2e-5 relative
    expect(compareJson({ x: 1e-7 }, { x: 0 }, DEFAULT_TOLERANCE).pass).toBe(true);     // absolute near zero
  });

  it("applies the looser ARIMA tolerance only to ARIMA fields", () => {
    const ref = { models: { arima: { aicc: 187.81 }, naive: { wape: 13.84 } } };
    const arimaOff = { models: { arima: { aicc: 187.81 * (1 + 3e-6) }, naive: { wape: 13.84 } } };
    const naiveOff = { models: { arima: { aicc: 187.81 }, naive: { wape: 13.84 * (1 + 3e-6) } } };
    expect(compareJson(arimaOff, ref).pass).toBe(true);
    expect(compareJson(naiveOff, ref).pass).toBe(false);
    expect(3e-6).toBeLessThan(ARIMA_TOLERANCE);
  });

  it("reports structural mismatches with their path", () => {
    const report = compareJson({ a: [1, 2], b: "x", c: 1 }, { a: [1], b: "y", d: 1 });
    expect(report.pass).toBe(false);
    expect(report.mismatches.join(" ")).toMatch(/a: length 2 vs 1/);
    expect(report.mismatches.join(" ")).toMatch(/keys differ/);
  });

  it("fails on NaN instead of silently passing", () => {
    expect(compareJson({ x: Number.NaN }, { x: 1 }).pass).toBe(false);
  });
});
