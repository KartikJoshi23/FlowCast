import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ModelKey, Snapshot } from "../data/types";
import { mathWorking } from "../lib/math";
import { forecastChartOption, metricBarsOption } from "./options";

const snapshot = JSON.parse(readFileSync(new URL("../../public/data/snapshot.json", import.meta.url), "utf8")) as Snapshot;
const analysis = snapshot.default;
const allVisible = { naive: true, snaive: true, arima: true, rf: true, xgb: true } as Record<ModelKey, boolean>;

type Series = { id: string; name: string; data: (number | null)[]; markArea?: { data: { name?: string; xAxis: string }[][] } };

describe("forecastChartOption", () => {
  const option = forecastChartOption({ analysis, visible: allVisible, focus: "arima" });
  const series = option.series as unknown as Series[];
  const byId = (id: string) => series.find((s) => s.id === id)!;

  it("spans history plus forecast months on one category axis", () => {
    expect((option.xAxis as { data: string[] }).data).toHaveLength(15);
    const actual = byId("actual").data;
    expect(actual.slice(0, 12).every((v) => v !== null)).toBe(true);
    expect(actual.slice(12)).toEqual([null, null, null]);
  });

  it("shades the test window and the forecast period", () => {
    const areas = byId("actual").markArea!.data;
    expect(areas[0][0]).toMatchObject({ name: "Test window", xAxis: "May '23" });
    expect(areas[0][1]).toMatchObject({ xAxis: "Jul '23" });
    expect(areas[1][0]).toMatchObject({ name: "Forecast", xAxis: "Aug '23" });
  });

  it("places test predictions only in the test window and connects forecasts to the last actual", () => {
    const naiveTest = byId("naive-test").data;
    expect(naiveTest.slice(9, 12)).toEqual([4961, 4961, 4961]);
    expect(naiveTest.filter((v) => v !== null)).toHaveLength(3);
    const naiveForecast = byId("naive-forecast").data;
    expect(naiveForecast[11]).toBe(5661);                 // last actual month (Jul 2023)
    expect(naiveForecast.slice(12)).toEqual([5661, 5661, 5661]);
  });

  it("draws Seasonal Naive's forecast but no test line in year one", () => {
    expect(series.some((s) => s.id === "snaive-test")).toBe(false);
    expect(series.some((s) => s.id === "snaive-forecast")).toBe(true);
  });

  it("adds stacked uncertainty layers for the focus model only, kept out of the legend", () => {
    expect(series.filter((s) => s.id.startsWith("band-"))).toHaveLength(4);
    expect((option.legend as { data: string[] }).data).toEqual(["Actual", "Naive", "Seasonal Naive", "ARIMA", "Random Forest", "XGBoost"]);
    const noBand = forecastChartOption({ analysis, visible: allVisible, focus: "xgb" });
    expect((noBand.series as unknown as Series[]).some((s) => s.id.startsWith("band-"))).toBe(false);
  });

  it("omits hidden models from series and legend", () => {
    const hidden = forecastChartOption({ analysis, visible: { ...allVisible, rf: false }, focus: "arima" });
    expect((hidden.series as unknown as Series[]).some((s) => s.id.startsWith("rf"))).toBe(false);
    expect((hidden.legend as { data: string[] }).data).not.toContain("Random Forest");
  });
});

describe("metricBarsOption", () => {
  it("lists evaluated models best first with their WAPE", () => {
    const option = metricBarsOption(analysis, "wape");
    expect((option.yAxis as { data: string[] }).data).toEqual(["Naive", "ARIMA", "Random Forest", "XGBoost"]);
    const values = (option.series[0].data as { value: number }[]).map((d) => Number(d.value.toFixed(2)));
    expect(values).toEqual([13.84, 13.84, 20.35, 22.51]);
  });
});

describe("mathWorking", () => {
  it("reproduces the notebook's hand calculation for Naive", () => {
    const work = mathWorking(analysis.result.models.naive.test!.metrics.per_month);
    expect(work.sumAbsError).toBe(2391);
    expect(work.sumAbsActual).toBe(17274);
    expect(work.shortfallUnits).toBe(2391);
    expect(work.surplusUnits).toBe(0);
    expect(work.apeTerms.map((v) => Number(v.toFixed(2)))).toEqual([10.47, 18.3, 12.37]);
    expect((100 * work.sumAbsError) / work.sumAbsActual).toBeCloseTo(analysis.result.models.naive.test!.metrics.wape.value!, 10);
  });
});
