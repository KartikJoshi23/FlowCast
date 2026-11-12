/**
 * Builders for the exploration views (trend, seasonality, features). Same mark specs as options.ts.
 */
import type { ImportanceRow, ScenarioResult } from "../data/types";
import { fmtMonth, fmtMonthShort, fmtUnits } from "../lib/format";
import { CHART } from "../lib/models";

const KEEP_AXIS_LABELS_INSIDE = { outerBoundsMode: "same", outerBoundsContain: "axisLabel" } as const;
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Ordinal ramp for years on the dark surface: older = deeper blue, newer = lighter (monotonic lightness). */
export const YEAR_RAMP = ["#2a78d6", "#5598e7", "#86b6ef", "#b7d3f6"];

const axis = {
  axisLine: { lineStyle: { color: CHART.axis } },
  axisTick: { show: false },
  axisLabel: { color: CHART.ink3, fontSize: 11 },
  splitLine: { lineStyle: { color: CHART.grid, width: 1, type: "solid" } },
};

const tooltip = {
  backgroundColor: "rgba(9, 20, 34, 0.94)",
  borderColor: "rgba(150, 200, 255, 0.18)",
  borderWidth: 1,
  padding: [8, 10],
  textStyle: { color: CHART.ink1, fontSize: 12, fontFamily: "Inter Variable, Segoe UI, sans-serif" },
  extraCssText: "border-radius: 10px;",
};

const units = (v: number) => fmtUnits(v);

/** Full history of the selected level with markers for the first-year boundary and the 24-month point. */
export function lifecycleOption(result: ScenarioResult, firstYearMonths: number) {
  const months = result.actual.months;
  const lines: Record<string, unknown>[] = [];
  if (months.length > firstYearMonths) lines.push({ xAxis: fmtMonthShort(months[firstYearMonths - 1]), label: { formatter: "end of first year" } });
  if (months.length >= 24) lines.push({ xAxis: fmtMonthShort(months[23]), label: { formatter: "24 months: seasonality learnable" } });
  const peak = result.actual.units.indexOf(Math.max(...result.actual.units));
  return {
    grid: { left: 8, right: 24, top: 28, bottom: 8, ...KEEP_AXIS_LABELS_INSIDE },
    tooltip: { ...tooltip, trigger: "axis", axisPointer: { type: "line", lineStyle: { color: "rgba(180,210,255,.35)" } }, valueFormatter: units },
    xAxis: { type: "category", data: months.map(fmtMonthShort), boundaryGap: false, ...axis, splitLine: { show: false }, axisLabel: { ...axis.axisLabel, hideOverlap: true } },
    yAxis: { type: "value", min: 0, ...axis, axisLine: { show: false }, axisLabel: { ...axis.axisLabel, formatter: units } },
    aria: { enabled: true },
    series: [
      {
        id: "lifecycle",
        name: "Units",
        type: "line",
        data: result.actual.units,
        lineStyle: { color: CHART.actual, width: 2 },
        itemStyle: { color: CHART.actual, borderColor: CHART.surface, borderWidth: 2 },
        symbol: "circle",
        symbolSize: 7,
        areaStyle: { color: CHART.actual, opacity: 0.06 },
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: "rgba(180,210,255,.35)", type: "solid", width: 1 },
          label: { color: CHART.ink3, fontSize: 11, position: "insideEndTop" },
          data: lines,
        },
        markPoint: {
          symbol: "circle",
          symbolSize: 1,
          label: { show: true, color: CHART.ink2, fontSize: 11, offset: [0, -14], formatter: () => `peak ${fmtUnits(result.actual.units[peak])}` },
          data: [{ coord: [fmtMonthShort(months[peak]), result.actual.units[peak]] }],
        },
      },
    ],
  };
}

/** Units by calendar month, one line per year (ordinal ramp, legend + end labels). */
export function yearOverYearOption(result: ScenarioResult) {
  const years = [...new Set(result.seasonality.profile.map((p) => p.year))].sort();
  const colours = years.map((_, i) => YEAR_RAMP[Math.max(0, YEAR_RAMP.length - years.length + i)]);
  return {
    grid: { left: 8, right: 16, top: 36, bottom: 8, ...KEEP_AXIS_LABELS_INSIDE },
    legend: { top: 0, left: 0, icon: "roundRect", itemWidth: 14, itemHeight: 3, textStyle: { color: CHART.ink2, fontSize: 12 } },
    tooltip: { ...tooltip, trigger: "axis", valueFormatter: units },
    xAxis: { type: "category", data: MONTH_NAMES, boundaryGap: false, ...axis, splitLine: { show: false } },
    yAxis: { type: "value", min: 0, ...axis, axisLine: { show: false }, axisLabel: { ...axis.axisLabel, formatter: units } },
    aria: { enabled: true },
    series: years.map((year, i) => {
      const data: (number | null)[] = MONTH_NAMES.map(() => null);
      result.seasonality.profile.filter((p) => p.year === year).forEach((p) => (data[p.calendar_month - 1] = p.units));
      return {
        id: `year-${year}`,
        name: String(year),
        type: "line",
        data,
        connectNulls: false,
        lineStyle: { color: colours[i], width: 2 },
        itemStyle: { color: colours[i], borderColor: CHART.surface, borderWidth: 2 },
        symbol: "circle",
        symbolSize: 7,
      };
    }),
  };
}

/** Autocorrelation bars with the ±1.96/√n significance band. */
export function acfOption(result: ScenarioResult) {
  const values = result.diagnostics.acf.slice(1);
  const bound = result.diagnostics.acf_bound;
  return {
    grid: { left: 8, right: 16, top: 12, bottom: 8, ...KEEP_AXIS_LABELS_INSIDE },
    tooltip: { ...tooltip, trigger: "item", formatter: (p: { name: string; value: number }) => `lag ${p.name}: <b>${p.value.toFixed(2)}</b>` },
    xAxis: { type: "category", data: values.map((_, i) => String(i + 1)), name: "lag (months)", nameLocation: "middle", nameGap: 24, nameTextStyle: { color: CHART.ink3 }, ...axis, splitLine: { show: false } },
    yAxis: { type: "value", min: -1, max: 1, ...axis, axisLine: { show: false } },
    aria: { enabled: true },
    series: [
      {
        id: "acf",
        type: "bar",
        barMaxWidth: 22,
        data: values.map((v) => ({ value: v, itemStyle: { color: Math.abs(v) > bound ? "#3987e5" : "rgba(57,135,229,.45)", borderRadius: v >= 0 ? [4, 4, 0, 0] : [0, 0, 4, 4] } })),
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: "rgba(180,210,255,.45)", type: "solid", width: 1 },
          label: { color: CHART.ink3, fontSize: 10, formatter: (p: { value: number }) => (p.value > 0 ? `significance ±${bound.toFixed(2)}` : "") },
          data: [{ yAxis: bound }, { yAxis: -bound }],
        },
      },
    ],
  };
}

/** Pooled series-level scatter: units vs the previous month (lag_1), with the 45° reference. */
export function lagScatterOption(points: { x: number; y: number; label: string }[]) {
  const max = Math.max(...points.flatMap((p) => [p.x, p.y]), 1) * 1.05;
  return {
    grid: { left: 8, right: 16, top: 12, bottom: 8, ...KEEP_AXIS_LABELS_INSIDE },
    tooltip: {
      ...tooltip,
      trigger: "item",
      formatter: (p: { dataIndex: number; seriesId: string }) =>
        p.seriesId === "points" ? `${points[p.dataIndex].label}<br/>previous month <b>${fmtUnits(points[p.dataIndex].x)}</b> → this month <b>${fmtUnits(points[p.dataIndex].y)}</b>` : "",
    },
    xAxis: { type: "value", min: 0, max, name: "lag_1 (previous month)", nameLocation: "middle", nameGap: 26, nameTextStyle: { color: CHART.ink3 }, ...axis, axisLabel: { ...axis.axisLabel, formatter: units } },
    yAxis: { type: "value", min: 0, max, name: "this month", nameTextStyle: { color: CHART.ink3 }, ...axis, axisLine: { show: false }, axisLabel: { ...axis.axisLabel, formatter: units } },
    aria: { enabled: true },
    series: [
      { id: "diagonal", type: "line", data: [[0, 0], [max, max]], symbol: "none", silent: true, lineStyle: { color: "rgba(180,210,255,.3)", width: 1 }, tooltip: { show: false } },
      {
        id: "points",
        type: "scatter",
        data: points.map((p) => [p.x, p.y]),
        symbolSize: 9,
        itemStyle: { color: "#3987e5", opacity: 0.75, borderColor: CHART.surface, borderWidth: 2 },
      },
    ],
  };
}

/** Feature importance (single series = single colour; values at the bar tips). */
export function importanceOption(rows: ImportanceRow[], colour: string) {
  const top = rows.slice(0, 8);
  return {
    grid: { left: 8, right: 48, top: 4, bottom: 4, ...KEEP_AXIS_LABELS_INSIDE },
    tooltip: { ...tooltip, trigger: "item", formatter: (p: { name: string; value: number }) => `${p.name}: <b>${(p.value * 100).toFixed(1)}%</b>` },
    xAxis: { type: "value", max: Math.min(1, Math.max(...top.map((r) => r.importance)) * 1.25), ...axis, axisLabel: { ...axis.axisLabel, formatter: (v: number) => `${Math.round(v * 100)}%` } },
    yAxis: { type: "category", inverse: true, data: top.map((r) => r.feature), ...axis, axisLabel: { color: CHART.ink2, fontSize: 11.5 }, splitLine: { show: false } },
    aria: { enabled: true },
    series: [
      {
        id: "importance",
        type: "bar",
        barMaxWidth: 18,
        data: top.map((r) => ({ value: r.importance, itemStyle: { color: colour, borderRadius: [0, 4, 4, 0] } })),
        label: { show: true, position: "right", color: CHART.ink1, fontSize: 11, formatter: (p: { value: number }) => `${Math.round(p.value * 100)}%` },
      },
    ],
  };
}

/** One small-multiple panel (shared y-max across panels so they compare). */
export function miniLineOption(months: string[], values: number[], yMax: number, colour: string = CHART.actual) {
  return {
    grid: { left: 4, right: 8, top: 8, bottom: 4, ...KEEP_AXIS_LABELS_INSIDE },
    tooltip: { ...tooltip, trigger: "axis", formatter: (p: { dataIndex: number }[]) => `${fmtMonth(months[p[0].dataIndex])}: <b>${fmtUnits(values[p[0].dataIndex])}</b>` },
    xAxis: { type: "category", data: months.map(fmtMonthShort), boundaryGap: false, ...axis, splitLine: { show: false }, axisLabel: { ...axis.axisLabel, fontSize: 10, hideOverlap: true } },
    yAxis: { type: "value", min: 0, max: yMax, splitNumber: 2, ...axis, axisLine: { show: false }, axisLabel: { ...axis.axisLabel, fontSize: 10, formatter: units } },
    series: [{ id: "mini", type: "line", data: values, symbol: "none", lineStyle: { color: colour, width: 2 }, areaStyle: { color: colour, opacity: 0.06 } }],
  };
}
