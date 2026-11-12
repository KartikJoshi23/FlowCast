import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { monthlyTotals, nextMonth, slicePanel } from "./panel";
import type { Panel } from "./types";

const panel = JSON.parse(readFileSync(new URL("../../public/data/ju021_panel.json", import.meta.url), "utf8")) as Panel;

describe("panel helpers", () => {
  it("slices months, series and operational counts consistently", () => {
    const fy = slicePanel(panel, 12);
    expect(fy.months).toHaveLength(12);
    expect(fy.months.at(-1)).toBe("2023-07");
    for (const values of Object.values(fy.series)) expect(values).toHaveLength(12);
    for (const bySeries of Object.values(fy.ops ?? {})) {
      for (const values of Object.values(bySeries ?? {})) expect(values).toHaveLength(12);
    }
    expect(panel.months).toHaveLength(29); // original untouched
  });

  it("matches the notebook's first-year total (58,295 units)", () => {
    expect(monthlyTotals(slicePanel(panel, 12)).reduce((a, b) => a + b, 0)).toBe(58295);
    expect(monthlyTotals(panel).slice(9, 12)).toEqual([5541, 6072, 5661]);
  });

  it("rejects impossible slices", () => {
    expect(() => slicePanel(panel, 0)).toThrow(RangeError);
    expect(() => slicePanel(panel, 30)).toThrow(RangeError);
  });

  it("computes the next month across year ends", () => {
    expect(nextMonth("2023-07")).toBe("2023-08");
    expect(nextMonth("2024-12")).toBe("2025-01");
  });
});
