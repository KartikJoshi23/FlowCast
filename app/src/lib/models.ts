import type { ModelKey } from "../data/types";

/**
 * Display metadata per model. Colour follows the model everywhere (never its rank).
 * Hex values are the validated dark-mode categorical palette (worst adjacent CVD dE 8.4,
 * all >= 3:1 against the glass surface #0b1626); keep in sync with global.css tokens.
 */
export const MODEL_META: Record<ModelKey, { label: string; color: string; hex: string; family: string; dash: number[] }> = {
  naive: { label: "Naive", color: "var(--color-m-naive)", hex: "#3987e5", family: "Baseline", dash: [6, 4] },
  snaive: { label: "Seasonal Naive", color: "var(--color-m-snaive)", hex: "#d95926", family: "Baseline", dash: [8, 3, 2, 3] },
  arima: { label: "ARIMA", color: "var(--color-m-arima)", hex: "#199e70", family: "Statistical", dash: [2, 3] },
  rf: { label: "Random Forest", color: "var(--color-m-rf)", hex: "#c98500", family: "Machine learning", dash: [] },
  xgb: { label: "XGBoost", color: "var(--color-m-xgb)", hex: "#d55181", family: "Machine learning", dash: [10, 3] },
};

/** Chart chrome colours (text tokens; data never colours text). */
export const CHART = {
  actual: "#f0efec",
  surface: "#0b1626",
  ink1: "#eef4fb",
  ink2: "#b4c3d6",
  ink3: "#7f90a6",
  grid: "rgba(150, 200, 255, 0.08)",
  axis: "rgba(150, 200, 255, 0.18)",
  testWindow: "rgba(124, 196, 255, 0.07)",
  forecastWindow: "rgba(79, 214, 232, 0.06)",
};
