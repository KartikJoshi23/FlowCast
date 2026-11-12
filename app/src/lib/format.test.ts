import { describe, expect, it } from "vitest";
import { fmtDeviation, fmtDuration, fmtMonth, fmtMonthShort, fmtPct, fmtUnits, levelPhrase } from "./format";

describe("formatting", () => {
  it("formats months", () => {
    expect(fmtMonth("2023-05")).toBe("May 2023");
    expect(fmtMonthShort("2024-12")).toBe("Dec '24");
  });

  it("formats units and percentages", () => {
    expect(fmtUnits(5661.4)).toBe("5,661");
    expect(fmtUnits(null)).toBe("n/a");
    expect(fmtPct(13.84)).toBe("13.8%");
    expect(fmtPct(-13.84)).toBe("-13.8%");
    expect(fmtPct(4.2, true)).toBe("+4.2%");
    expect(fmtPct(-4.2, true)).toBe("−4.2%");
    expect(fmtPct(Number.NaN)).toBe("n/a");
  });

  it("phrases market levels", () => {
    expect(levelPhrase("total")).toBe("all regions and channels");
    expect(levelPhrase("region:PL-North")).toBe("region PL-North");
  });

  it("formats durations and deviations", () => {
    expect(fmtDuration(850)).toBe("850 ms");
    expect(fmtDuration(1630)).toBe("1.6 s");
    expect(fmtDeviation(0)).toBe("0 (exact)");
    expect(fmtDeviation(2.89e-6)).toBe("2.9e-6");
  });
});
