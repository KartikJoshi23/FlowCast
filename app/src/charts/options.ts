/**
 * Pure builders that turn an engine result into ECharts options (unit-tested).
 * Mark specs follow the dashboard's data-viz rules: 2px lines, 8px markers with a surface ring,
 * ~10% area washes, hairline solid grid, one y-axis, legend for 2+ series, values in text tokens.
 */
import type { Analysis, ModelKey } from "../data/types";
import { MODEL_KEYS } from "../data/types";
import { fmtMonth, fmtMonthShort, fmtPct, fmtUnits } from "../lib/format";
import { CHART, MODEL_META } from "../lib/models";

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

/** ECharts 6 replacement for the deprecated `grid.containLabel: true`. */
const KEEP_AXIS_LABELS_INSIDE = { outerBoundsMode: "same", outerBoundsContain: "axisLabel" } as const;

const axisBase = {
  axisLine: { lineStyle: { color: CHART.axis } },
  axisTick: { show: false },
  axisLabel: { color: CHART.ink3, fontSize: 11 },
  splitLine: { lineStyle: { color: CHART.grid, width: 1, type: "solid" } },
};

const tooltipBase = {
  backgroundColor: "rgba(9, 20, 34, 0.94)",
  borderColor: "rgba(150, 200, 255, 0.18)",
  borderWidth: 1,
  padding: [10, 12],
  textStyle: { color: CHART.ink1, fontSize: 12, fontFamily: "Inter Variable, Segoe UI, sans-serif" },
  extraCssText: "border-radius: 12px; box-shadow: 0 12px 30px -12px rgba(0,0,0,.6); backdrop-filter: blur(8px);",
};

/** Tooltip row: a short line-key in the series colour, the value strong, the label secondary. */
const tooltipRow = (color: string, label: string, value: string, dashed = false) =>
  `<div style="display:flex;align-items:center;gap:8px;margin-top:4px">` +
  `<span style="display:inline-block;width:14px;height:0;border-top:2px ${dashed ? "dashed" : "solid"} ${color}"></span>` +
  `<span style="font-weight:600;min-width:52px;font-variant-numeric:tabular-nums">${escapeHtml(value)}</span>` +
  `<span style="color:${CHART.ink2}">${escapeHtml(label)}</span></div>`;

export interface ForecastChartInput {
  analysis: Analysis;
  visible: Record<ModelKey, boolean>;
  focus: ModelKey;
}

/** Actual sales + each visible model's test-window prediction and forecast (+ ranges for the focus model). */
export function forecastChartOption({ analysis, visible, focus }: ForecastChartInput) {
  const { result } = analysis;
  const history = result.actual.months;
  const future = result.meta.future_months;
  const months = [...history, ...future];
  const idx = new Map(months.map((m, i) => [m, i]));
  const lastActualIndex = history.length - 1;
  const lastActual = result.actual.units[lastActualIndex];
  const empty = () => months.map(() => null as number | null);

  const actual = empty();
  result.actual.units.forEach((v, i) => (actual[i] = v));

  const series: Record<string, unknown>[] = [
    {
      id: "actual",
      name: "Actual",
      type: "line",
      data: actual,
      lineStyle: { color: CHART.actual, width: 2 },
      itemStyle: { color: CHART.actual, borderColor: CHART.surface, borderWidth: 2 },
      symbol: "circle",
      symbolSize: 8,
      z: 5,
      markArea: {
        silent: true,
        label: { color: CHART.ink3, fontSize: 11, position: "insideTop", distance: 6 },
        data: [
          [
            { name: "Test window", xAxis: fmtMonthShort(result.meta.test_months[0]), itemStyle: { color: CHART.testWindow } },
            { xAxis: fmtMonthShort(result.meta.test_months[result.meta.test_months.length - 1]) },
          ],
          [
            { name: "Forecast", xAxis: fmtMonthShort(future[0]), itemStyle: { color: CHART.forecastWindow } },
            { xAxis: fmtMonthShort(future[future.length - 1]) },
          ],
        ],
      },
    },
  ];

  const legend = ["Actual"];
  for (const key of MODEL_KEYS) {
    if (!visible[key]) continue;
    const model = result.models[key];
    const meta = MODEL_META[key];
    if (model.test) {
      const data = empty();
      model.test.months.forEach((m, i) => (data[idx.get(m)!] = model.test!.predicted[i]));
      series.push({
        id: `${key}-test`,
        name: meta.label,
        type: "line",
        data,
        connectNulls: false,
        lineStyle: { color: meta.hex, width: 2 },
        itemStyle: { color: meta.hex, borderColor: CHART.surface, borderWidth: 2 },
        symbol: "circle",
        symbolSize: 8,
        z: 4,
      });
    }
    if (model.forecast) {
      const data = empty();
      data[lastActualIndex] = lastActual;              // connect the forecast to the last actual month
      model.forecast.months.forEach((m, i) => (data[idx.get(m)!] = model.forecast!.point[i]));
      series.push({
        id: `${key}-forecast`,
        name: meta.label,
        type: "line",
        data,
        lineStyle: { color: meta.hex, width: 2, type: [6, 4] },
        itemStyle: { color: meta.hex, borderColor: CHART.surface, borderWidth: 2 },
        symbol: (_: unknown, p: { dataIndex: number }) => (p.dataIndex === lastActualIndex ? "none" : "circle"),
        symbolSize: 8,
        z: 4,
      });
    }
    if (model.test || model.forecast) legend.push(meta.label);
  }

  // Uncertainty ranges for the focus model: stacked washes (95% outer, 80% inner).
  const focusModel = result.models[focus];
  const fc = focusModel?.forecast;
  if (visible[focus] && fc?.lo80 && fc.hi80 && fc.lo95 && fc.hi95) {
    const hex = MODEL_META[focus].hex;
    const layer = (id: string, values: (i: number) => number, opacity: number) => {
      const data = empty();
      fc.months.forEach((m, i) => (data[idx.get(m)!] = values(i)));
      return {
        id: `band-${id}`,
        name: `band-${id}`,
        type: "line",
        stack: "band",
        data,
        symbol: "none",
        lineStyle: { opacity: 0 },
        areaStyle: { color: hex, opacity },
        tooltip: { show: false },
        silent: true,
        z: 1,
      };
    };
    series.push(
      layer("base", (i) => fc.lo95![i], 0),
      layer("lo", (i) => fc.lo80![i] - fc.lo95![i], 0.1),
      layer("mid", (i) => fc.hi80![i] - fc.lo80![i], 0.22),
      layer("hi", (i) => fc.hi95![i] - fc.hi80![i], 0.1),
    );
  }

  return {
    grid: { left: 8, right: 16, top: 44, bottom: 8, ...KEEP_AXIS_LABELS_INSIDE },
    legend: {
      data: legend,
      top: 0,
      left: 0,
      icon: "roundRect",
      itemWidth: 14,
      itemHeight: 3,
      textStyle: { color: CHART.ink2, fontSize: 12 },
      inactiveColor: "#3b4a5e",
    },
    tooltip: {
      ...tooltipBase,
      trigger: "axis",
      axisPointer: { type: "line", lineStyle: { color: "rgba(180, 210, 255, 0.35)", width: 1 } },
      formatter: (params: { dataIndex: number }[]) => {
        const i = params[0]?.dataIndex ?? 0;
        const month = months[i];
        const isFuture = i > lastActualIndex;
        let html = `<div style="color:${CHART.ink3};font-size:11px;letter-spacing:.04em">${escapeHtml(fmtMonth(month))}${
          isFuture ? " · forecast" : result.meta.test_months.includes(month) ? " · test window" : ""
        }</div>`;
        if (!isFuture) html += tooltipRow(CHART.actual, "Actual", fmtUnits(result.actual.units[i]));
        for (const key of MODEL_KEYS) {
          if (!visible[key]) continue;
          const m = result.models[key];
          const testI = m.test?.months.indexOf(month) ?? -1;
          const fcI = m.forecast?.months.indexOf(month) ?? -1;
          if (testI >= 0) html += tooltipRow(MODEL_META[key].hex, MODEL_META[key].label, fmtUnits(m.test!.predicted[testI]));
          if (fcI >= 0) {
            let text = fmtUnits(m.forecast!.point[fcI]);
            if (key === focus && m.forecast!.lo80 && m.forecast!.hi80) {
              text += `  (80%: ${fmtUnits(m.forecast!.lo80[fcI])}–${fmtUnits(m.forecast!.hi80[fcI])})`;
            }
            html += tooltipRow(MODEL_META[key].hex, MODEL_META[key].label, text, true);
          }
        }
        return html;
      },
    },
    xAxis: {
      type: "category",
      data: months.map(fmtMonthShort),
      boundaryGap: false,
      ...axisBase,
      splitLine: { show: false },
      axisLabel: { ...axisBase.axisLabel, hideOverlap: true },
    },
    yAxis: {
      type: "value",
      min: 0,
      ...axisBase,
      axisLine: { show: false },
      axisLabel: { ...axisBase.axisLabel, formatter: (v: number) => fmtUnits(v) },
    },
    aria: { enabled: true },
    series,
  };
}

/** Horizontal bars of one metric for every evaluated model (best first), value at the tip. */
export function metricBarsOption(analysis: Analysis, metric: "mape" | "wape") {
  const rows = analysis.result.ranking
    .map((r) => ({ key: r.model, value: metric === "wape" ? r.wape_pct : r.mape_pct }))
    .filter((r): r is { key: ModelKey; value: number } => r.value !== null);
  const max = Math.max(...rows.map((r) => r.value), 1);
  return {
    grid: { left: 8, right: 56, top: 6, bottom: 6, ...KEEP_AXIS_LABELS_INSIDE },
    tooltip: {
      ...tooltipBase,
      trigger: "item",
      formatter: (p: { dataIndex: number }) => {
        const r = rows[p.dataIndex];
        return tooltipRow(MODEL_META[r.key].hex, `${MODEL_META[r.key].label} · ${metric.toUpperCase()}`, fmtPct(r.value));
      },
    },
    xAxis: {
      type: "value",
      min: 0,
      max: Math.ceil((max * 1.15) / 5) * 5,
      ...axisBase,
      axisLabel: { ...axisBase.axisLabel, formatter: (v: number) => `${v}%` },
    },
    yAxis: {
      type: "category",
      inverse: true,
      data: rows.map((r) => MODEL_META[r.key].label),
      ...axisBase,
      axisLabel: { color: CHART.ink2, fontSize: 12 },
      splitLine: { show: false },
    },
    aria: { enabled: true },
    series: [
      {
        id: `${metric}-bars`,
        type: "bar",
        barMaxWidth: 22,
        data: rows.map((r) => ({ value: r.value, itemStyle: { color: MODEL_META[r.key].hex, borderRadius: [0, 4, 4, 0] } })),
        label: {
          show: true,
          position: "right",
          color: CHART.ink1,
          fontSize: 12,
          formatter: (p: { value: number }) => fmtPct(p.value),
        },
      },
    ],
  };
}
