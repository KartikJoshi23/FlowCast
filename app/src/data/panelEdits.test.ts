import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseMonthlyCsv, toMonthlyCsv } from "./csv";
import { buildWorkingPanel, monthlyTotals, NO_EDITS, splitTotal } from "./panel";
import { SERIES_KEYS, type Panel } from "./types";

const full = JSON.parse(readFileSync(new URL("../../public/data/ju021_panel.json", import.meta.url), "utf8")) as Panel;

describe("buildWorkingPanel", () => {
  it("returns the first year unchanged when there are no edits", () => {
    const p = buildWorkingPanel(full, 12, NO_EDITS);
    expect(p.months).toHaveLength(12);
    expect(monthlyTotals(p).reduce((a, b) => a + b, 0)).toBe(58295);
    expect(p.user_added).toEqual([]);
    expect(p.ops?.rows?.[SERIES_KEYS[0]]?.[0]).toBe(full.ops?.rows?.[SERIES_KEYS[0]]?.[0]);
  });

  it("applies overrides, nulls their operational counts and discloses edited months", () => {
    const p = buildWorkingPanel(full, 12, { ...NO_EDITS, overrides: { "2023-06": { "PL-North|Retail": 999 } }, modified: ["2023-06"] });
    expect(p.series["PL-North|Retail"][10]).toBe(999);
    expect(p.ops?.stockout_rows?.["PL-North|Retail"]?.[10]).toBeNull();
    expect(p.ops?.stockout_rows?.["PL-North|Retail"]?.[9]).not.toBeNull();
    expect(p.user_modified).toEqual(["2023-06"]);
  });

  it("appends user months only after the dataset's last revealed month, contiguously", () => {
    const series = Object.fromEntries(SERIES_KEYS.map((k) => [k, 100]));
    const after = buildWorkingPanel(full, 29, { ...NO_EDITS, extra: [{ month: "2025-01", series }], added: ["2025-01"] });
    expect(after.months.at(-1)).toBe("2025-01");
    expect(monthlyTotals(after).at(-1)).toBe(900);
    expect(after.user_added).toEqual(["2025-01"]);
    const early = buildWorkingPanel(full, 12, { ...NO_EDITS, extra: [{ month: "2025-01", series }], added: ["2025-01"] });
    expect(early.months.at(-1)).toBe("2023-07");          // not contiguous -> ignored
    expect(early.user_added).toEqual([]);
  });
});

describe("splitTotal", () => {
  it("splits a total by the latest 3-month mix into whole units that add up exactly", () => {
    const parts = splitTotal(5000, buildWorkingPanel(full, 12));
    expect(Object.values(parts).reduce((a, b) => a + b, 0)).toBe(5000);
    expect(Object.values(parts).every((v) => Number.isInteger(v) && v > 400 && v < 700)).toBe(true);
  });
});

describe("CSV import and export", () => {
  const fy = buildWorkingPanel(full, 12);

  it("round-trips the long layout", () => {
    const parsed = parseMonthlyCsv(toMonthlyCsv(fy), fy);
    expect(parsed.errors).toEqual([]);
    expect(parsed.months).toHaveLength(12);
    expect(parsed.months.every((m) => m.action === "edit")).toBe(true);
    expect(parsed.months[9].series["PL-North|Retail"]).toBe(fy.series["PL-North|Retail"][9]);
  });

  it("adds the next months from totals and rejects gaps and bad values", () => {
    const csv = "month,total\n2023-08,4600\n2023-09,3700\n2023-11,2800\n2023-10,-5\n";
    const parsed = parseMonthlyCsv(csv, fy);
    expect(parsed.months.map((m) => [m.month, m.action])).toEqual([["2023-08", "add"], ["2023-09", "add"]]);
    expect(Object.values(parsed.months[0].series).reduce((a, b) => a + b, 0)).toBe(4600);
    expect(parsed.errors.join(" ")).toMatch(/Row 5: units must be a whole number/);
    expect(parsed.errors.join(" ")).toMatch(/2023-11: months must continue the data without gaps/);
  });

  it("requires all nine series per month in the long layout and known names", () => {
    const parsed = parseMonthlyCsv("month,region,channel,units\n2023-08,PL-North,Retail,500\n2023-08,Mars,Retail,1\n", fy);
    expect(parsed.months).toEqual([]);
    expect(parsed.errors.join(" ")).toMatch(/unknown region or channel/);
    expect(parsed.errors.join(" ")).toMatch(/all 9 region × channel rows are needed/);
  });

  it("explains an unrecognised header", () => {
    expect(parseMonthlyCsv("date,sales\n2023-08,1\n", fy).errors[0]).toMatch(/Header must be/);
  });
});
