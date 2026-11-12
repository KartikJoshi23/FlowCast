/**
 * Parity check: does the in-browser engine reproduce the notebook's numbers?
 *
 * Walks two JSON values in parallel. Strings, booleans, nulls and structure must match exactly;
 * numbers must agree to within `tolerance`, measured as |a - b| / max(|b|, 1): relative for large
 * values, absolute for values below 1. Written with erasable TypeScript only, so the Node
 * verification script can import this file directly.
 */

export interface ParityReport {
  pass: boolean;
  compared: number;
  maxDeviation: number;
  worstPath: string | null;
  mismatches: string[];
}

export const DEFAULT_TOLERANCE = 1e-6;
/** ARIMA is fitted by numerical maximum likelihood; native and WebAssembly optimisers may stop
 *  a few millionths apart, so ARIMA fields use a looser bound (plan section 12). */
export const ARIMA_TOLERANCE = 1e-4;

export type Tolerance = number | ((path: string) => number);

/** Tolerance rule used for notebook <-> browser parity. */
export const notebookTolerance = (path: string): number =>
  path.includes("arima") ? ARIMA_TOLERANCE : DEFAULT_TOLERANCE;

export function compareJson(live: unknown, reference: unknown, tolerance: Tolerance = notebookTolerance): ParityReport {
  const toleranceAt = typeof tolerance === "number" ? () => tolerance : tolerance;
  const report: ParityReport = { pass: true, compared: 0, maxDeviation: 0, worstPath: null, mismatches: [] };

  const fail = (path: string, why: string) => {
    if (report.mismatches.length < 20) report.mismatches.push(`${path || "(root)"}: ${why}`);
    report.pass = false;
  };

  const walk = (a: unknown, b: unknown, path: string): void => {
    if (typeof a === "number" && typeof b === "number") {
      report.compared += 1;
      const deviation = Math.abs(a - b) / Math.max(Math.abs(b), 1);
      if (deviation > report.maxDeviation) {
        report.maxDeviation = deviation;
        report.worstPath = path;
      }
      if (!(deviation <= toleranceAt(path))) fail(path, `${a} vs ${b}`);
      return;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return fail(path, `length ${a.length} vs ${b.length}`);
      a.forEach((item, i) => walk(item, b[i], `${path}[${i}]`));
      return;
    }
    if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
      const ka = Object.keys(a as object);
      const kb = Object.keys(b as object);
      const missing = kb.filter((k) => !(k in (a as object)));
      const extra = ka.filter((k) => !(k in (b as object)));
      if (missing.length || extra.length) {
        fail(path, `keys differ (missing: ${missing.join(", ") || "none"}; extra: ${extra.join(", ") || "none"})`);
      }
      // Keep comparing the keys both sides share, so one structural difference does not hide others.
      kb.filter((k) => k in (a as object)).forEach((k) =>
        walk((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], path ? `${path}.${k}` : k),
      );
      return;
    }
    if (a !== b) fail(path, `${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
  };

  walk(live, reference, "");
  return report;
}
