import type { PerMonthError } from "../data/types";

/**
 * Presentation helpers for the "Show the math" view. The metric VALUES always come from the
 * engine; these functions only lay out the arithmetic (sums of the engine's per-month errors)
 * and split absolute error into shortfall and surplus units for the business-impact view.
 */
export interface MathWorking {
  n: number;
  nUsedForMape: number;
  apeTerms: number[];
  sumAbsError: number;
  sumAbsActual: number;
  sumSignedError: number;
  shortfallUnits: number;
  surplusUnits: number;
}

export function mathWorking(rows: PerMonthError[]): MathWorking {
  const used = rows.filter((r) => r.abs_pct_error !== null);
  return {
    n: rows.length,
    nUsedForMape: used.length,
    apeTerms: used.map((r) => r.abs_pct_error as number),
    sumAbsError: rows.reduce((a, r) => a + r.abs_error, 0),
    sumAbsActual: rows.reduce((a, r) => a + Math.abs(r.actual), 0),
    sumSignedError: rows.reduce((a, r) => a + r.error, 0),
    shortfallUnits: rows.reduce((a, r) => a + Math.max(r.actual - r.forecast, 0), 0),
    surplusUnits: rows.reduce((a, r) => a + Math.max(r.forecast - r.actual, 0), 0),
  };
}

/** Two-decimal percentage for the worked formulas. */
export const pct2 = (v: number | null | undefined) =>
  v === null || v === undefined || !Number.isFinite(v) ? "n/a" : `${v.toFixed(2)}%`;
