import { SERIES_KEYS, type OpsField, type Panel } from "./types";

/** First `n` months of a panel, including operational counts (mirrors the engine's slice_panel). */
export function slicePanel(panel: Panel, n: number): Panel {
  if (!Number.isInteger(n) || n < 1 || n > panel.months.length) {
    throw new RangeError(`Cannot take ${n} months from a panel of ${panel.months.length}.`);
  }
  const sliced: Panel = {
    ...panel,
    months: panel.months.slice(0, n),
    series: Object.fromEntries(Object.entries(panel.series).map(([k, v]) => [k, v.slice(0, n)])),
  };
  if (panel.ops) {
    sliced.ops = Object.fromEntries(
      Object.entries(panel.ops).map(([field, bySeries]) => [
        field,
        Object.fromEntries(Object.entries(bySeries ?? {}).map(([k, v]) => [k, v.slice(0, n)])),
      ]),
    ) as Panel["ops"];
  }
  return sliced;
}

/** Monthly totals over all series (or a subset of series keys). */
export function monthlyTotals(panel: Panel, keys: readonly string[] = Object.keys(panel.series)): number[] {
  return panel.months.map((_, i) => keys.reduce((sum, k) => sum + (panel.series[k]?.[i] ?? 0), 0));
}

/** "YYYY-MM" for the month after `month`. */
export function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 1));        // m is 1-based, so this is the following month
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Operational counts are unknown for user-entered months. */
export const OPS_FIELDS: readonly OpsField[] = ["rows", "stockout_rows", "promo_rows", "promo_units"];

export type SeriesValues = Record<string, number>;

/**
 * User changes on top of the dataset:
 *  - overrides: values typed (or uploaded) for months the dataset has, replacing its values;
 *  - extra: months after the dataset ends, entered by the user;
 *  - added: months whose values came from the user rather than the feed (new months);
 *  - modified: dataset months whose values the user edited (what-if).
 */
export interface DataEdits {
  overrides: Record<string, SeriesValues>;
  extra: { month: string; series: SeriesValues }[];
  added: string[];
  modified: string[];
}

export const NO_EDITS: DataEdits = { overrides: {}, extra: [], added: [], modified: [] };

/**
 * The data the company has right now: the first `revealed` dataset months, with the user's
 * overrides applied and user-entered months appended. Operational counts become null wherever
 * the values came from the user (they are unknown).
 */
export function buildWorkingPanel(full: Panel, revealed: number, edits: DataEdits = NO_EDITS): Panel {
  const base = slicePanel(full, revealed);
  const series = Object.fromEntries(SERIES_KEYS.map((k) => [k, [...(base.series[k] ?? [])]])) as Record<string, number[]>;
  const ops = Object.fromEntries(
    OPS_FIELDS.map((f) => [f, Object.fromEntries(SERIES_KEYS.map((k) => [k, [...(base.ops?.[f]?.[k] ?? base.months.map(() => null))]]))]),
  ) as Record<OpsField, Record<string, (number | null)[]>>;

  base.months.forEach((month, i) => {
    const override = edits.overrides[month];
    if (!override) return;
    for (const [key, value] of Object.entries(override)) {
      if (!(key in series)) continue;
      series[key][i] = value;
      OPS_FIELDS.forEach((f) => (ops[f][key][i] = null));
    }
  });

  const months = [...base.months];
  for (const row of edits.extra) {
    if (row.month !== nextMonth(months[months.length - 1])) break;   // only contiguous months
    months.push(row.month);
    for (const key of SERIES_KEYS) {
      series[key].push(row.series[key] ?? 0);
      OPS_FIELDS.forEach((f) => ops[f][key].push(null));
    }
  }

  const inData = new Set(months);
  return {
    ...base,
    months,
    series,
    ops,
    user_added: edits.added.filter((m) => inData.has(m)),
    user_modified: edits.modified.filter((m) => inData.has(m) && !edits.added.includes(m)),
  };
}

/**
 * Split a monthly total across the 9 series by their share of the last 3 months (largest-remainder
 * rounding, so the parts are whole units that add up exactly to the total).
 */
export function splitTotal(total: number, panel: Panel): SeriesValues {
  const n = panel.months.length;
  const recent = SERIES_KEYS.map((k) => (panel.series[k] ?? []).slice(Math.max(0, n - 3)).reduce((a, b) => a + b, 0));
  const sum = recent.reduce((a, b) => a + b, 0);
  const shares = sum > 0 ? recent.map((v) => v / sum) : SERIES_KEYS.map(() => 1 / SERIES_KEYS.length);
  const raw = shares.map((s) => s * total);
  const floors = raw.map(Math.floor);
  let remainder = Math.round(total) - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (remainder <= 0) break;
    floors[i] += 1;
    remainder -= 1;
  }
  return Object.fromEntries(SERIES_KEYS.map((k, i) => [k, floors[i]]));
}
