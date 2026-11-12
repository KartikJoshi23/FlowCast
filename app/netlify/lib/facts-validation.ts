/**
 * Server-side validation of the facts document sent by the browser.
 *
 * The browser is untrusted. To keep the LLM endpoint from being used as a free-form proxy, or
 * from being steered by text injected into the facts, the server accepts only:
 *   - the engine's own key names;
 *   - numbers, booleans and null;
 *   - strings the engine can actually produce (an allowlist of exact values and patterns).
 * Anything else is rejected with a reason, and the request never reaches the model.
 */

export const MAX_FACTS_CHARS = 40_000;
const MAX_DEPTH = 7;
const MAX_ARRAY = 80;

const MODEL_KEYS = ["naive", "snaive", "arima", "rf", "xgb"];
const MODEL_LABELS = ["Naive", "Seasonal Naive", "ARIMA", "Random Forest", "XGBoost"];
const REGIONS = ["PL-Central", "PL-North", "PL-South"];
const CHANNELS = ["Discount", "E-commerce", "Retail"];
const FEATURES = [
  "lag_1", "lag_2", "lag_3", "lag_12", "rolling_mean_3", "months_since_launch", "month_sin", "month_cos",
  "is_summer", "days_in_month", "region (one-hot)", "channel (one-hot)",
];

const ALLOWED_STRINGS = new Set<string>([
  ...MODEL_KEYS, ...MODEL_LABELS, ...REGIONS, ...CHANNELS, ...FEATURES,
  "baseline", "statistical", "machine learning",
  "total", ...REGIONS.map((r) => `region:${r}`), ...CHANNELS.map((c) => `channel:${c}`),
  "Total (all regions and channels)", ...REGIONS.map((r) => `Region ${r}`), ...CHANNELS.map((c) => `Channel ${c}`),
  "New flavored water (proxy series: SKU JU-021, a juice, in a synthetic FMCG dataset)",
  "Bottom-up: the model forecasts each region x channel series directly.",
  "Split of the level forecast by each series' share of the last 3 months.",
  "none", "tree-spread heuristic (10-90 / 2.5-97.5 percentiles)",
  "No ARIMA candidate could be estimated on the training window.",
  "No ARIMA candidate could be estimated.",
  "Needs at least 12 months of history.",
]);

const ALLOWED_PATTERNS = [
  /^\d{4}-(0[1-9]|1[0-2])$/,                                             // months
  /^Needs at least 12 training months; only \d{1,2} are available\.$/,
  /^ARIMA\(\d,\d,\d\)(\(0,1,0\)\[12\])?( with (drift|constant))?$/,
];

const ALLOWED_KEYS = new Set<string>([
  ...MODEL_KEYS,
  "abs_error_units", "actual", "best_models", "bias_pct", "by_channel", "by_model", "by_region",
  "calendar_months_seen_twice", "change_last3_vs_prev3_pct", "channel", "channels", "context", "coverage80_pct",
  "data_through", "distribution_plan", "est_lost_units_last3", "evaluated", "family", "first3_avg_units",
  "first_full_month", "forecast", "forecast_months", "forecast_reason", "forecast_total_units", "growth_vs_first3_pct",
  "hi80", "hi95", "horizon_months", "identical_forecasts_to", "identifiable", "interval", "label",
  "last3_avg_units", "last3_vs_prev3_pct", "latest_month", "latest_units", "launch_month", "level", "level_key",
  "lo80", "lo95", "low_month", "low_units", "mape_pct", "markets", "method", "model", "models", "mom_change_pct",
  "month", "months", "months_after_first_year", "months_needed_for_seasonality", "months_of_data", "n_points",
  "n_scored", "not_evaluated_reason", "operations", "peak_month", "peak_units", "per_month", "prev3_avg_units",
  "product", "promo_share_pct", "promo_uplift_ratio", "rank", "ranking", "recent_actuals", "region", "regions",
  "seasonality", "seasonality_identifiable", "selected_model", "share_last3_pct", "share_pct", "skill_vs_naive_pct",
  "split", "stockout_rows_last3", "summer_avg_units", "summer_vs_winter_pct", "test", "test_end", "test_months",
  "test_start", "top_features", "total_units", "tracking", "train_end", "train_months", "train_start",
  "training_rows_forecast_fit", "training_rows_test_fit", "trend", "units", "units_last3", "user_added_months",
  "user_modified_months", "wape_pct", "winter_avg_units", "yoy_latest_pct",
]);

const REQUIRED_SECTIONS = ["context", "split", "trend", "seasonality", "models", "ranking"];

export type Facts = Record<string, unknown>;
export type ValidationResult = { ok: true; facts: Facts } | { ok: false; error: string };

export const isAllowedString = (s: string) => ALLOWED_STRINGS.has(s) || ALLOWED_PATTERNS.some((p) => p.test(s));

export function validateFacts(input: unknown): ValidationResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "facts must be a JSON object" };
  const size = JSON.stringify(input).length;
  if (size > MAX_FACTS_CHARS) return { ok: false, error: `facts too large (${size} characters)` };

  let problem: string | null = null;
  const walk = (value: unknown, path: string, depth: number): void => {
    if (problem) return;
    if (depth > MAX_DEPTH) {
      problem = `${path}: nested too deeply`;
    } else if (value === null || typeof value === "boolean") {
      return;
    } else if (typeof value === "number") {
      if (!Number.isFinite(value)) problem = `${path}: number must be finite`;
    } else if (typeof value === "string") {
      if (!isAllowedString(value)) problem = `${path}: unexpected text value`;
    } else if (Array.isArray(value)) {
      if (value.length > MAX_ARRAY) problem = `${path}: list too long`;
      else value.forEach((v, i) => walk(v, `${path}[${i}]`, depth + 1));
    } else if (typeof value === "object") {
      for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
        if (!ALLOWED_KEYS.has(key)) {
          problem = `${path ? `${path}.` : ""}${key}: unexpected key`;
          return;
        }
        walk(v, path ? `${path}.${key}` : key, depth + 1);
      }
    } else {
      problem = `${path}: unsupported value`;
    }
  };
  walk(input, "", 0);
  if (problem) return { ok: false, error: problem };

  const facts = input as Facts;
  const missing = REQUIRED_SECTIONS.filter((k) => !(k in facts));
  if (missing.length) return { ok: false, error: `facts missing sections: ${missing.join(", ")}` };
  return { ok: true, facts };
}
