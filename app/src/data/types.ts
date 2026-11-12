/**
 * Types mirroring the JSON produced by the Python engine (forecast_core.py, exported from the
 * notebook). Field names stay snake_case so the data flows through unchanged.
 */

export type ModelKey = "naive" | "snaive" | "arima" | "rf" | "xgb";
export const MODEL_KEYS: readonly ModelKey[] = ["naive", "snaive", "arima", "rf", "xgb"];

export const REGIONS = ["PL-Central", "PL-North", "PL-South"] as const;
export const CHANNELS = ["Discount", "E-commerce", "Retail"] as const;
export type Region = (typeof REGIONS)[number];
export type Channel = (typeof CHANNELS)[number];
export const SERIES_KEYS: readonly string[] = REGIONS.flatMap((r) => CHANNELS.map((c) => `${r}|${c}`));

export type Level = "total" | `region:${Region}` | `channel:${Channel}`;

export type OpsField = "rows" | "stockout_rows" | "promo_rows" | "promo_units";

/** Monthly units per region x channel series (+ optional operational counts). */
export interface Panel {
  sku: string;
  launch_date: string;
  launch_month: string;
  months: string[];
  first_year_months: number;
  series: Record<string, number[]>;
  ops?: Partial<Record<OpsField, Record<string, (number | null)[]>>>;
  user_added?: string[];
  user_modified?: string[];
  product_label?: string;
  held_back_from?: string;
  source?: { dataset: string; author: string; url: string; license: string; note: string };
}

export interface LogEntry {
  origin: string;
  level: Level;
  model: ModelKey;
  target: string;
  step: number;
  forecast: number;
  lo80: number | null;
  hi80: number | null;
  lo95: number | null;
  hi95: number | null;
}

export interface ScenarioConfig {
  level: Level;
  test_size: number;
  horizon: number;
  arima_order: [number, number, number] | null;
  tracking_log?: LogEntry[];
}

export interface MetricValue {
  value: number | null;
  reason: string | null;
}

export interface MapeValue extends MetricValue {
  n_used: number;
  n_excluded_zero: number;
  near_zero_warning: boolean;
}

export interface PerMonthError {
  month: string;
  actual: number;
  forecast: number;
  error: number;
  abs_error: number;
  abs_pct_error: number | null;
}

export interface Metrics {
  mape: MapeValue;
  wape: MetricValue;
  bias: MetricValue;
  abs_error_units: number;
  per_month: PerMonthError[];
}

export interface ForecastBlock {
  months: string[];
  point: number[];
  lo80: number[] | null;
  hi80: number[] | null;
  lo95: number[] | null;
  hi95: number[] | null;
}

export interface ImportanceRow {
  feature: string;
  importance: number;
}

export interface ModelResult {
  key: ModelKey;
  label: string;
  family: string;
  evaluated: boolean;
  not_evaluated_reason: string | null;
  test: {
    months: string[];
    predicted: number[];
    metrics: Metrics;
    skill_vs_naive_pct: number | null;
    identical_to: ModelKey[];
  } | null;
  forecast: ForecastBlock | null;
  forecast_reason: string | null;
  info: {
    label?: string;
    method?: string;
    training_rows?: number;
    features?: string[];
    importance?: ImportanceRow[];
    interval?: string;
    test_fit?: { label?: string; training_rows?: number; features?: string[] };
    [key: string]: unknown;
  };
}

export interface RankingRow {
  rank: number;
  model: ModelKey;
  label: string;
  wape_pct: number;
  mape_pct: number | null;
  bias_pct: number | null;
}

export interface FeatureSpec {
  lags: number[];
  rolling: boolean;
  lag12: boolean;
  numeric: string[];
  columns: string[];
}

export interface ScenarioMeta {
  level: Level;
  level_label: string;
  n_months: number;
  n_train: number;
  n_test: number;
  horizon: number;
  months: string[];
  train_months: string[];
  test_months: string[];
  future_months: string[];
  data_through: string;
  launch_month: string;
  first_year_months: number;
  user_added: string[];
  user_modified: string[];
  seasonality_identifiable: boolean;
  feature_spec_test: FeatureSpec;
  feature_spec_forecast: FeatureSpec;
}

export interface MixRow {
  region?: Region;
  channel?: Channel;
  units_last3: number;
  share_last3_pct: number | null;
  change_last3_vs_prev3_pct: number | null;
}

export interface TrackingSummary {
  n_scored: number;
  by_model: {
    model: ModelKey;
    label: string;
    n_points: number;
    wape_pct: number | null;
    mape_pct: number | null;
    bias_pct: number | null;
    coverage80_pct: number | null;
    coverage95_pct: number | null;
  }[];
  scored: (LogEntry & { actual: number })[];
}

export interface ScenarioResult {
  engine_version: string;
  config: Omit<ScenarioConfig, "tracking_log">;
  meta: ScenarioMeta;
  actual: { months: string[]; units: number[] };
  models: Record<ModelKey, ModelResult>;
  ranking: RankingRow[];
  best_models: ModelKey[];
  distribution: {
    model: ModelKey;
    label: string;
    method: string;
    months: string[];
    cells: { region: Region; channel: Channel; units: number[]; total: number }[];
  } | null;
  trend: Record<string, number | string | null>;
  seasonality: {
    months_of_data: number;
    identifiable: boolean;
    calendar_months_seen_twice: number;
    summer_avg_units: number | null;
    winter_avg_units: number | null;
    summer_vs_winter_pct: number | null;
    profile: { calendar_month: number; year: number; units: number }[];
  };
  regions: MixRow[];
  channels: MixRow[];
  operations: {
    stockout_rows_last3: number | null;
    est_lost_units_last3: number | null;
    promo_uplift_ratio: number | null;
    promo_share_pct: number | null;
    method: string;
  };
  diagnostics: {
    acf: number[];
    acf_bound: number;
    lag_pairs: { month: string; y: number; lag_1: number; lag_2: number | null }[];
  };
  features: { columns: string[]; rows: Record<string, number | string>[] } | null;
  tracking: TrackingSummary | null;
  new_log_entries: LogEntry[];
}

export interface Interpretation {
  seasonality_trend: { answer: string; evidence: string[] };
  best_model: { answer: string; evidence: string[] };
  recommendations: { title: string; detail: string; evidence: string[] }[];
  caveats: string[];
}

export interface GroundingResult {
  numbers_checked: number;
  unverified_numbers: string[];
  invalid_evidence_keys: string[];
  passed: boolean;
}

/** Facts are deliberately loosely typed: they are a JSON document for the LLM. */
export type Facts = Record<string, unknown>;

/** What the engine returns for one scenario. */
export interface Analysis {
  result: ScenarioResult;
  facts: Facts;
  rule_based: Interpretation;
  rule_based_grounding: GroundingResult;
}

export interface ReplayModelSnapshot {
  evaluated: boolean;
  test_predicted: number[] | null;
  mape: number | null;
  wape: number | null;
  bias: number | null;
  forecast: ForecastBlock | null;
  arima_label: string | null;
}

export interface ReplayStep {
  data_through: string;
  n_months: number;
  best_models: ModelKey[];
  models: Record<ModelKey, ReplayModelSnapshot>;
}

/** The notebook's export: default scenario + compact replay, used for first paint and parity. */
export interface Snapshot {
  engine_version: string;
  engine_sha256: string | null;
  pyodide_version: string;
  libraries: Record<string, string>;
  created_utc: string;
  default_config: Omit<ScenarioConfig, "tracking_log">;
  default: Analysis;
  replay: ReplayStep[];
}
