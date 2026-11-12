"""Forecasting engine for the beverage-demand dashboard.

GENERATED FILE - do not edit by hand.
Source: notebooks/beverage_demand_forecasting.ipynb (code cells tagged "core").
Regenerate with:  python scripts/export_engine.py
"""


# ---------------------------------------------------------------------------
# Forecasting engine - constants
# ---------------------------------------------------------------------------
import json
import math
import warnings
from decimal import ROUND_HALF_UP, Decimal

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from statsmodels.tsa.arima.model import ARIMA
from statsmodels.tsa.stattools import acf
from xgboost import XGBRegressor

ENGINE_VERSION = "1.0.0"

PRODUCT_SKU = "JU-021"                       # proxy for the new flavored water
REGIONS = ("PL-Central", "PL-North", "PL-South")
CHANNELS = ("Discount", "E-commerce", "Retail")
SERIES = tuple(f"{r}|{c}" for r in REGIONS for c in CHANNELS)   # the 9 sub-series

MODEL_ORDER = ("naive", "snaive", "arima", "rf", "xgb")
MODEL_LABELS = {
    "naive": "Naive",
    "snaive": "Seasonal Naive",
    "arima": "ARIMA",
    "rf": "Random Forest",
    "xgb": "XGBoost",
}
MODEL_FAMILY = {
    "naive": "baseline",
    "snaive": "baseline",
    "arima": "statistical",
    "rf": "machine learning",
    "xgb": "machine learning",
}

SEASON_PERIOD = 12          # months in one seasonal cycle
MIN_TRAIN_MONTHS = 6        # never train on fewer months than this
RICH_LAG_MIN_TRAIN = 12     # lag_3 and rolling_mean_3 need >= 12 training months
SEASONAL_MIN_TRAIN = 24     # lag_12 / seasonal ARIMA need two full cycles
MAX_TEST_MONTHS = 6
MAX_HORIZON = 6
TIE_TOLERANCE_PP = 0.05     # models within 0.05 WAPE points share a rank
NEAR_ZERO_SHARE = 0.05      # |actual| < 5% of mean |actual| -> MAPE warning
RANDOM_STATE = 42
Z80 = 1.2815515655446004    # standard-normal quantiles for 80% / 95% intervals
Z95 = 1.959963984540054

DEFAULT_CONFIG = {"level": "total", "test_size": 3, "horizon": 3, "arima_order": None, "tracking_log": []}


def panel_frame(panel: dict) -> pd.DataFrame:
    """Validate a JSON-style panel and return a DataFrame (rows = months, columns = the 9 series)."""
    months = list(panel["months"])
    if not months:
        raise ValueError("The panel contains no months.")
    index = pd.PeriodIndex(months, freq="M")
    if index.has_duplicates or not index.is_monotonic_increasing:
        raise ValueError("Months must be unique and in chronological order.")
    if len(pd.period_range(index[0], index[-1], freq="M")) != len(index):
        raise ValueError("Months must be consecutive (no gaps).")
    data = {}
    for key in SERIES:
        values = np.asarray(panel["series"][key], dtype=float)
        if values.shape != (len(index),):
            raise ValueError(f"Series {key} has {values.size} values for {len(index)} months.")
        if not np.all(np.isfinite(values)) or np.any(values < 0):
            raise ValueError(f"Series {key} contains negative or non-numeric units.")
        data[key] = values
    return pd.DataFrame(data, index=index)


def level_columns(level: str) -> list:
    """Series that are summed for a level: 'total', 'region:<name>' or 'channel:<name>'."""
    if level == "total":
        return list(SERIES)
    kind, _, name = level.partition(":")
    if kind == "region" and name in REGIONS:
        return [s for s in SERIES if s.split("|")[0] == name]
    if kind == "channel" and name in CHANNELS:
        return [s for s in SERIES if s.split("|")[1] == name]
    raise ValueError(f"Unknown level {level!r}.")


def level_label(level: str) -> str:
    if level == "total":
        return "Total (all regions and channels)"
    kind, _, name = level.partition(":")
    return f"{kind.capitalize()} {name}"


def slice_panel(panel: dict, n_months: int) -> dict:
    """First n_months of a panel (series and operational counts), keeping metadata."""
    out = {k: v for k, v in panel.items() if k not in ("months", "series", "ops")}
    out["months"] = list(panel["months"][:n_months])
    out["series"] = {k: list(v[:n_months]) for k, v in panel["series"].items()}
    if panel.get("ops"):
        out["ops"] = {f: {k: list(v[:n_months]) for k, v in d.items()} for f, d in panel["ops"].items()}
    return out


def feature_spec(n_train: int) -> dict:
    """Which features are allowed given the number of training months."""
    lags = [1, 2] + ([3] if n_train >= RICH_LAG_MIN_TRAIN else [])
    use_rolling = n_train >= RICH_LAG_MIN_TRAIN
    use_lag12 = n_train >= SEASONAL_MIN_TRAIN
    numeric = ([f"lag_{l}" for l in lags] + (["rolling_mean_3"] if use_rolling else [])
               + (["lag_12"] if use_lag12 else [])
               + ["months_since_launch", "month_sin", "month_cos", "is_summer", "days_in_month"])
    dummies = [f"region={r}" for r in REGIONS] + [f"channel={c}" for c in CHANNELS]
    return {"lags": lags, "rolling": use_rolling, "lag12": use_lag12,
            "numeric": numeric, "columns": numeric + dummies}


def feature_row(history, period, series_key: str, spec: dict, launch) -> dict:
    """Features for one series in one month, using only values observed BEFORE that month."""
    row = {}
    for lag in spec["lags"]:
        row[f"lag_{lag}"] = float(history[-lag]) if len(history) >= lag else np.nan
    if spec["rolling"]:
        row["rolling_mean_3"] = float(np.mean(history[-3:])) if len(history) >= 3 else np.nan
    if spec["lag12"]:
        row["lag_12"] = float(history[-12]) if len(history) >= 12 else np.nan
    month = period.month
    row["months_since_launch"] = float((period - launch).n)
    row["month_sin"] = math.sin(2 * math.pi * month / 12)
    row["month_cos"] = math.cos(2 * math.pi * month / 12)
    row["is_summer"] = 1.0 if month in (6, 7, 8) else 0.0
    row["days_in_month"] = float(period.days_in_month)
    region, channel = series_key.split("|")
    for r in REGIONS:
        row[f"region={r}"] = 1.0 if r == region else 0.0
    for c in CHANNELS:
        row[f"channel={c}"] = 1.0 if c == channel else 0.0
    return row


def build_training_set(frame: pd.DataFrame, spec: dict, launch):
    """Pooled training table: one row per (series, month) whose features are all available."""
    rows, target, keys = [], [], []
    for key in SERIES:
        values = frame[key].to_numpy(dtype=float)
        for t in range(values.size):
            row = feature_row(values[:t], frame.index[t], key, spec, launch)
            if any(np.isnan(row[c]) for c in spec["numeric"]):
                continue
            rows.append(row)
            target.append(values[t])
            keys.append({"series": key, "month": str(frame.index[t])})
    return pd.DataFrame(rows, columns=spec["columns"]), np.asarray(target, dtype=float), keys


def make_ml_model(kind: str):
    if kind == "rf":
        return RandomForestRegressor(n_estimators=200, min_samples_leaf=2,
                                     random_state=RANDOM_STATE, n_jobs=1)
    if kind == "xgb":
        return XGBRegressor(n_estimators=300, max_depth=2, learning_rate=0.05, subsample=1.0,
                            colsample_bytree=1.0, objective="reg:squarederror",
                            random_state=RANDOM_STATE, n_jobs=1)
    raise ValueError(kind)


def fit_ml(kind: str, frame: pd.DataFrame, launch) -> dict:
    spec = feature_spec(len(frame))
    X, y, keys = build_training_set(frame, spec, launch)
    model = make_ml_model(kind)
    model.fit(X, y)
    return {"model": model, "spec": spec, "X": X, "y": y, "keys": keys}


def ml_recursive_forecast(fitted: dict, frame: pd.DataFrame, launch, h: int, with_trees: bool = False):
    """Recursive multi-step forecast for all 9 series. Optionally per-tree predictions (RF)."""
    model, spec = fitted["model"], fitted["spec"]
    history = {k: list(frame[k].to_numpy(dtype=float)) for k in SERIES}
    last = frame.index[-1]
    point = {k: [] for k in SERIES}
    per_tree = []                                     # one (n_trees x 9) array per step
    for step in range(1, h + 1):
        period = last + step
        X = pd.DataFrame([feature_row(history[k], period, k, spec, launch) for k in SERIES],
                         columns=spec["columns"])
        if with_trees:
            # One prediction per tree; the forest's point forecast is their mean.
            trees = np.stack([est.predict(X.to_numpy(dtype=float)) for est in model.estimators_])
            per_tree.append(trees)
            pred = np.maximum(trees.mean(axis=0), 0.0)
        else:
            pred = np.maximum(np.asarray(model.predict(X), dtype=float), 0.0)
        for i, k in enumerate(SERIES):
            point[k].append(float(pred[i]))
            history[k].append(float(pred[i]))
    return point, per_tree


def feature_importance(model, columns) -> list:
    """Normalised importance with the one-hot identifiers grouped into 'region' and 'channel'."""
    raw = np.asarray(model.feature_importances_, dtype=float)
    total = float(raw.sum()) or 1.0
    grouped = {}
    for col, value in zip(columns, raw / total):
        name = "region (one-hot)" if col.startswith("region=") else (
            "channel (one-hot)" if col.startswith("channel=") else col)
        grouped[name] = grouped.get(name, 0.0) + float(value)
    return sorted(({"feature": k, "importance": v} for k, v in grouped.items()),
                  key=lambda d: -d["importance"])


def _interval(point, se) -> dict:
    point = np.asarray(point, dtype=float)
    se = np.asarray(se, dtype=float)
    return {
        "lo80": np.maximum(point - Z80 * se, 0.0), "hi80": point + Z80 * se,
        "lo95": np.maximum(point - Z95 * se, 0.0), "hi95": point + Z95 * se,
    }


def forecast_naive(y, h: int) -> dict:
    """Naive forecast: repeat the last value; random-walk prediction interval."""
    y = np.asarray(y, dtype=float)
    point = np.repeat(y[-1], h)
    out = {"point": point, "info": {"method": "Last observed month carried forward."}}
    resid = np.diff(y)
    if resid.size >= 1:
        sigma = float(np.sqrt(np.mean(resid ** 2)))
        out.update(_interval(point, sigma * np.sqrt(np.arange(1, h + 1))))
        out["info"]["residual_sigma"] = sigma
    return out


def forecast_snaive(y, h: int, m: int = SEASON_PERIOD):
    """Seasonal naive forecast: same month one year earlier. None if fewer than m months."""
    y = np.asarray(y, dtype=float)
    n = y.size
    if n < m:
        return None
    point = np.array([y[n - m + (i % m)] for i in range(h)])
    out = {"point": point, "info": {"method": "Same calendar month one year earlier."}}
    resid = y[m:] - y[:-m]
    if resid.size >= 3:
        sigma = float(np.sqrt(np.mean(resid ** 2)))
        k = np.arange(h) // m
        out.update(_interval(point, sigma * np.sqrt(k + 1)))
        out["info"]["residual_sigma"] = sigma
    return out


def arima_label(order, seasonal_order, trend) -> str:
    text = f"ARIMA({order[0]},{order[1]},{order[2]})"
    if seasonal_order and seasonal_order[3]:
        text += f"({seasonal_order[0]},{seasonal_order[1]},{seasonal_order[2]})[{seasonal_order[3]}]"
    if trend == "t":
        text += " with drift"
    elif trend == "c":
        text += " with constant"
    return text


def _arima_candidates(n_obs: int, order_override=None) -> list:
    seasonal = n_obs >= SEASONAL_MIN_TRAIN
    sorder = (0, 1, 0, SEASON_PERIOD) if seasonal else (0, 0, 0, 0)
    if order_override is not None:
        p, d, q = (int(v) for v in order_override)
        trend = "n" if (d + sorder[1]) > 0 else "c"
        return [((p, d, q), sorder, trend)]
    candidates = []
    for p in (0, 1):
        for q in (0, 1):
            for trend in (("n",) if seasonal else ("n", "t")):
                candidates.append(((p, 1, q), sorder, trend))
    return candidates


def forecast_arima(y, h: int, order_override=None):
    """Small-grid ARIMA chosen by AICc; returns point forecast and model-based intervals."""
    y = np.asarray(y, dtype=float)
    n = y.size
    best, tried = None, []
    for order, sorder, trend in _arima_candidates(n, order_override):
        k = order[0] + order[2] + (1 if trend in ("c", "t") else 0) + 1      # + noise variance
        n_eff = n - order[1] - sorder[1] * sorder[3]
        label = arima_label(order, sorder, trend)
        if n_eff - k - 1 <= 0:
            tried.append({"model": label, "aicc": None, "status": "skipped: too few observations"})
            continue
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            try:
                res = ARIMA(y, order=order, seasonal_order=sorder, trend=trend).fit()
            except Exception as exc:          # numerical failure on tiny samples
                tried.append({"model": label, "aicc": None, "status": f"failed: {type(exc).__name__}"})
                continue
        aicc = float(res.aicc)
        tried.append({"model": label, "aicc": aicc if np.isfinite(aicc) else None,
                      "status": "fitted", "warnings": len(caught)})
        if np.isfinite(aicc) and (best is None or aicc < best[0] - 1e-9):
            best = (aicc, order, sorder, trend, res, len(caught))
    if best is None:
        return None
    aicc, order, sorder, trend, res, n_warn = best
    fc = res.get_forecast(h)
    point = np.asarray(fc.predicted_mean, dtype=float)
    ci80 = np.asarray(fc.conf_int(alpha=0.20), dtype=float)
    ci95 = np.asarray(fc.conf_int(alpha=0.05), dtype=float)
    return {
        "point": point,
        "lo80": np.maximum(ci80[:, 0], 0.0), "hi80": ci80[:, 1],
        "lo95": np.maximum(ci95[:, 0], 0.0), "hi95": ci95[:, 1],
        "info": {"label": arima_label(order, sorder, trend), "order": list(order),
                 "seasonal_order": list(sorder), "trend": trend, "aicc": aicc,
                 "convergence_warnings": n_warn, "candidates": tried,
                 "method": "Lowest AICc on a small (p,1,q) grid."},
    }


def mape(actual, forecast) -> dict:
    """Mean Absolute Percentage Error (%), excluding months whose actual is exactly zero."""
    a = np.asarray(actual, dtype=float)
    f = np.asarray(forecast, dtype=float)
    used = a != 0
    out = {"value": None, "n_used": int(used.sum()), "n_excluded_zero": int((~used).sum()),
           "near_zero_warning": False, "reason": None}
    if not used.any():
        out["reason"] = "MAPE is undefined because every actual value is zero."
        return out
    ape = np.abs(a[used] - f[used]) / np.abs(a[used])
    out["value"] = float(100.0 * ape.mean())
    scale = float(np.mean(np.abs(a)))
    out["near_zero_warning"] = bool(np.any(np.abs(a[used]) < NEAR_ZERO_SHARE * scale))
    return out


def wape(actual, forecast) -> dict:
    """Weighted Absolute Percentage Error (%) = total absolute error / total actual volume."""
    a = np.asarray(actual, dtype=float)
    f = np.asarray(forecast, dtype=float)
    denom = float(np.sum(np.abs(a)))
    if denom == 0:
        return {"value": None, "reason": "WAPE is undefined because total actual volume is zero."}
    return {"value": float(100.0 * np.sum(np.abs(a - f)) / denom), "reason": None}


def bias(actual, forecast) -> dict:
    """Signed bias (%) = total (forecast - actual) / total actual volume. Negative = under-forecast."""
    a = np.asarray(actual, dtype=float)
    f = np.asarray(forecast, dtype=float)
    denom = float(np.sum(np.abs(a)))
    if denom == 0:
        return {"value": None, "reason": "Bias is undefined because total actual volume is zero."}
    return {"value": float(100.0 * np.sum(f - a) / denom), "reason": None}


def evaluate_forecast(actual, forecast, months) -> dict:
    """All accuracy figures for one model on one test window, plus the per-month working."""
    a = np.asarray(actual, dtype=float)
    f = np.asarray(forecast, dtype=float)
    per_month = []
    for m, ai, fi in zip(months, a, f):
        per_month.append({
            "month": str(m), "actual": float(ai), "forecast": float(fi), "error": float(fi - ai),
            "abs_error": float(abs(fi - ai)),
            "abs_pct_error": None if ai == 0 else float(100.0 * abs(fi - ai) / abs(ai)),
        })
    return {"mape": mape(a, f), "wape": wape(a, f), "bias": bias(a, f),
            "abs_error_units": float(np.sum(np.abs(a - f))), "per_month": per_month}


def round_half_up(value, ndigits: int = 0):
    """Round half away from zero (the same rule the dashboard uses); None stays None."""
    if value is None:
        return None
    q = Decimal(1).scaleb(-ndigits)
    return float(Decimal(repr(float(value))).quantize(q, rounding=ROUND_HALF_UP))


def normalize_config(config) -> dict:
    cfg = dict(DEFAULT_CONFIG)
    cfg.update({k: v for k, v in (config or {}).items() if v is not None or k == "arima_order"})
    cfg["test_size"] = int(cfg["test_size"])
    cfg["horizon"] = int(cfg["horizon"])
    if not 1 <= cfg["test_size"] <= MAX_TEST_MONTHS:
        raise ValueError(f"test_size must be between 1 and {MAX_TEST_MONTHS}.")
    if not 1 <= cfg["horizon"] <= MAX_HORIZON:
        raise ValueError(f"horizon must be between 1 and {MAX_HORIZON}.")
    level_columns(cfg["level"])                          # validates the level
    if cfg["arima_order"] is not None:
        p, d, q = (int(v) for v in cfg["arima_order"])
        if not (0 <= p <= 2 and 0 <= d <= 1 and 0 <= q <= 2):
            raise ValueError("ARIMA order override must have p, q in 0..2 and d in 0..1.")
        cfg["arima_order"] = [p, d, q]
    cfg["tracking_log"] = list(cfg.get("tracking_log") or [])
    return cfg


def _model_entry(key: str) -> dict:
    return {"key": key, "label": MODEL_LABELS[key], "family": MODEL_FAMILY[key],
            "evaluated": False, "not_evaluated_reason": None, "test": None,
            "forecast": None, "forecast_reason": None, "info": {}}


def _forecast_block(months, fc: dict) -> dict:
    block = {"months": [str(m) for m in months], "point": [float(v) for v in fc["point"]]}
    for b in ("lo80", "hi80", "lo95", "hi95"):
        block[b] = [float(v) for v in fc[b]] if fc.get(b) is not None else None
    return block


def _rank_models(models: dict) -> list:
    scored = [(m["test"]["metrics"]["wape"]["value"], MODEL_ORDER.index(k), k)
              for k, m in models.items()
              if m["evaluated"] and m["test"]["metrics"]["wape"]["value"] is not None]
    scored.sort()
    ranking, leader_wape, leader_rank = [], None, 0
    for position, (w, _, key) in enumerate(scored, start=1):
        if leader_wape is None or w - leader_wape > TIE_TOLERANCE_PP:
            leader_wape, leader_rank = w, position
        m = models[key]["test"]["metrics"]
        ranking.append({"rank": leader_rank, "model": key, "label": MODEL_LABELS[key],
                        "wape_pct": w, "mape_pct": m["mape"]["value"], "bias_pct": m["bias"]["value"]})
    return ranking


def _last_mix(frame: pd.DataFrame, cols: list, months: int = 3) -> dict:
    recent = frame[cols].iloc[-months:].sum()
    total = float(recent.sum())
    return {k: (float(recent[k]) / total if total else 1.0 / len(cols)) for k in cols}


def _ops_array(panel: dict, field: str, key: str, n: int):
    ops = panel.get("ops") or {}
    values = (ops.get(field) or {}).get(key)
    if values is None:
        return [None] * n
    return [None if v is None else float(v) for v in list(values)[:n]] + [None] * max(0, n - len(values))


def operations_summary(panel: dict, frame: pd.DataFrame, cols: list) -> dict:
    """Stockouts (lost sales) in the last 3 months and the promotion uplift, if counts exist."""
    n = len(frame)
    last3 = range(max(0, n - 3), n)
    stockout_rows, lost, have_stock = 0.0, 0.0, False
    promo_units = promo_rows = base_units = base_rows = 0.0
    have_promo = False
    for key in cols:
        units = frame[key].to_numpy(dtype=float)
        rows = _ops_array(panel, "rows", key, n)
        so = _ops_array(panel, "stockout_rows", key, n)
        pr = _ops_array(panel, "promo_rows", key, n)
        pu = _ops_array(panel, "promo_units", key, n)
        for t in range(n):
            if None in (rows[t], so[t]):
                continue
            in_stock = rows[t] - so[t]
            if t in last3:
                have_stock = True
                stockout_rows += so[t]
                if in_stock > 0:
                    lost += so[t] * units[t] / in_stock
            if None not in (pr[t], pu[t]):
                have_promo = True
                promo_units += pu[t]
                promo_rows += pr[t]
                base_units += units[t] - pu[t]
                base_rows += rows[t] - pr[t]
    uplift = None
    if have_promo and promo_rows > 0 and base_rows > 0 and base_units > 0:
        uplift = (promo_units / promo_rows) / (base_units / base_rows)
    return {
        "stockout_rows_last3": stockout_rows if have_stock else None,
        "est_lost_units_last3": lost if have_stock else None,
        "promo_uplift_ratio": uplift,
        "promo_share_pct": (100.0 * promo_rows / (promo_rows + base_rows)) if have_promo and (promo_rows + base_rows) else None,
        "method": "Lost units = stockout rows x average units per in-stock row of the same series-month.",
    }


def trend_summary(y: np.ndarray, months) -> dict:
    n = y.size
    out = {"latest_month": str(months[-1]), "latest_units": float(y[-1]),
           "mom_change_pct": None, "last3_avg_units": float(np.mean(y[-3:])),
           "prev3_avg_units": None, "last3_vs_prev3_pct": None,
           "peak_month": str(months[int(np.argmax(y))]), "peak_units": float(np.max(y)),
           "low_month": str(months[int(np.argmin(y))]), "low_units": float(np.min(y)),
           "yoy_latest_pct": None, "first3_avg_units": float(np.mean(y[:3])),
           "growth_vs_first3_pct": None}
    if n >= 2 and y[-2]:
        out["mom_change_pct"] = 100.0 * (y[-1] / y[-2] - 1.0)
    if n >= 6:
        prev3 = float(np.mean(y[-6:-3]))
        out["prev3_avg_units"] = prev3
        out["last3_vs_prev3_pct"] = 100.0 * (out["last3_avg_units"] / prev3 - 1.0) if prev3 else None
    if n >= 13 and y[-13]:
        out["yoy_latest_pct"] = 100.0 * (y[-1] / y[-13] - 1.0)
    if out["first3_avg_units"]:
        out["growth_vs_first3_pct"] = 100.0 * (out["last3_avg_units"] / out["first3_avg_units"] - 1.0)
    return out


def seasonality_summary(y: np.ndarray, months) -> dict:
    cal = np.array([m.month for m in months])
    summer = y[np.isin(cal, (6, 7, 8))]
    winter = y[np.isin(cal, (12, 1, 2))]
    counts = pd.Series(cal).value_counts()
    out = {
        "months_of_data": int(y.size),
        "identifiable": bool(y.size >= SEASONAL_MIN_TRAIN),
        "calendar_months_seen_twice": int((counts >= 2).sum()),
        "summer_avg_units": float(summer.mean()) if summer.size else None,
        "winter_avg_units": float(winter.mean()) if winter.size else None,
        "summer_vs_winter_pct": None,
        "profile": [{"calendar_month": int(m.month), "year": int(m.year), "units": float(v)}
                    for m, v in zip(months, y)],
    }
    if summer.size and winter.size and winter.mean():
        out["summer_vs_winter_pct"] = 100.0 * (summer.mean() / winter.mean() - 1.0)
    return out


def mix_summary(frame: pd.DataFrame, dim: str) -> list:
    names = REGIONS if dim == "region" else CHANNELS
    pos = 0 if dim == "region" else 1
    total_last3 = float(frame.iloc[-3:].to_numpy().sum())
    out = []
    for name in names:
        cols = [s for s in SERIES if s.split("|")[pos] == name]
        series = frame[cols].sum(axis=1).to_numpy(dtype=float)
        last3 = float(series[-3:].sum())
        prev3 = float(series[-6:-3].sum()) if series.size >= 6 else None
        out.append({dim: name, "units_last3": last3,
                    "share_last3_pct": 100.0 * last3 / total_last3 if total_last3 else None,
                    "change_last3_vs_prev3_pct": (100.0 * (last3 / prev3 - 1.0)) if prev3 else None})
    return out


def diagnostics_summary(y: np.ndarray, months) -> dict:
    n = y.size
    nlags = int(min(12, n - 2))
    acf_values = [float(v) for v in acf(y, nlags=nlags, fft=False)] if nlags >= 1 else [1.0]
    return {
        "acf": acf_values, "acf_bound": float(1.96 / math.sqrt(n)),
        "lag_pairs": [{"month": str(months[t]), "y": float(y[t]), "lag_1": float(y[t - 1]),
                       "lag_2": float(y[t - 2]) if t >= 2 else None} for t in range(1, n)],
    }


def forecast_log_entries(result: dict) -> list:
    """Forecasts made now, to be scored later when their actuals arrive (forecast tracking)."""
    entries = []
    origin = result["meta"]["data_through"]
    for key in MODEL_ORDER:
        fc = result["models"][key]["forecast"]
        if not fc:
            continue
        for i, month in enumerate(fc["months"]):
            entry = {"origin": origin, "level": result["config"]["level"], "model": key,
                     "target": month, "step": i + 1, "forecast": fc["point"][i]}
            for b in ("lo80", "hi80", "lo95", "hi95"):
                entry[b] = fc[b][i] if fc[b] is not None else None
            entries.append(entry)
    return entries


def score_tracking(log: list, level_series: pd.Series, level: str) -> dict:
    """Score earlier forecasts (same level) against actuals that have arrived since."""
    actual = {str(p): float(v) for p, v in level_series.items()}
    latest = {}
    for e in log:                                      # keep the latest copy of each forecast
        if e.get("level") == level:
            latest[(e["origin"], e["model"], e["target"])] = e
    scored = [dict(e, actual=actual[e["target"]]) for e in latest.values() if e["target"] in actual]
    by_model = []
    for key in MODEL_ORDER:
        rows = [e for e in scored if e["model"] == key]
        if not rows:
            continue
        a = np.array([e["actual"] for e in rows])
        f = np.array([e["forecast"] for e in rows])
        with_80 = [e for e in rows if e.get("lo80") is not None]
        with_95 = [e for e in rows if e.get("lo95") is not None]
        by_model.append({
            "model": key, "label": MODEL_LABELS[key], "n_points": len(rows),
            "wape_pct": wape(a, f)["value"], "mape_pct": mape(a, f)["value"],
            "bias_pct": bias(a, f)["value"],
            "coverage80_pct": (100.0 * np.mean([e["lo80"] <= e["actual"] <= e["hi80"] for e in with_80])) if with_80 else None,
            "coverage95_pct": (100.0 * np.mean([e["lo95"] <= e["actual"] <= e["hi95"] for e in with_95])) if with_95 else None,
        })
    scored.sort(key=lambda e: (e["target"], e["origin"], MODEL_ORDER.index(e["model"])))
    return {"n_scored": len(scored), "by_model": by_model, "scored": scored}


def run_scenario(panel: dict, config=None) -> dict:
    """Train/test evaluation + refit + forecast for every model, on the data available now."""
    cfg = normalize_config(config)
    frame = panel_frame(panel)
    launch = pd.Period(panel.get("launch_month", "2022-07"), freq="M")
    n = len(frame)
    n_test, h = cfg["test_size"], cfg["horizon"]
    n_train = n - n_test
    if n_train < MIN_TRAIN_MONTHS:
        raise ValueError(f"{n} months leave {n_train} training months; at least {MIN_TRAIN_MONTHS} are needed.")
    cols = level_columns(cfg["level"])
    level_series = frame[cols].sum(axis=1)
    y = level_series.to_numpy(dtype=float)
    months = frame.index
    test_months = months[n_train:]
    future_months = [months[-1] + i for i in range(1, h + 1)]
    actual_test = y[n_train:]
    train_frame = frame.iloc[:n_train]
    models = {k: _model_entry(k) for k in MODEL_ORDER}
    series_forecasts = {}                                 # per-series future forecasts (ML)

    def set_test(key, pred, info=None):
        models[key]["evaluated"] = True
        models[key]["test"] = {"months": [str(m) for m in test_months],
                               "predicted": [float(v) for v in pred],
                               "metrics": evaluate_forecast(actual_test, pred, test_months)}
        if info:
            models[key]["info"]["test_fit"] = info

    # --- Naive -----------------------------------------------------------
    set_test("naive", forecast_naive(y[:n_train], n_test)["point"])
    fut = forecast_naive(y, h)
    models["naive"]["forecast"] = _forecast_block(future_months, fut)
    models["naive"]["info"]["method"] = fut["info"]["method"]

    # --- Seasonal naive --------------------------------------------------
    test_fc = forecast_snaive(y[:n_train], n_test)
    if test_fc is None:
        models["snaive"]["not_evaluated_reason"] = (
            f"Needs at least {SEASON_PERIOD} training months; only {n_train} are available.")
    else:
        set_test("snaive", test_fc["point"])
    fut = forecast_snaive(y, h)
    if fut is None:
        models["snaive"]["forecast_reason"] = f"Needs at least {SEASON_PERIOD} months of history."
    else:
        models["snaive"]["forecast"] = _forecast_block(future_months, fut)
        models["snaive"]["info"]["method"] = fut["info"]["method"]

    # --- ARIMA -----------------------------------------------------------
    test_fc = forecast_arima(y[:n_train], n_test, cfg["arima_order"])
    if test_fc is None:
        models["arima"]["not_evaluated_reason"] = "No ARIMA candidate could be estimated on the training window."
    else:
        set_test("arima", test_fc["point"], {"label": test_fc["info"]["label"]})
    fut = forecast_arima(y, h, cfg["arima_order"])
    if fut is None:
        models["arima"]["forecast_reason"] = "No ARIMA candidate could be estimated."
    else:
        models["arima"]["forecast"] = _forecast_block(future_months, fut)
        models["arima"]["info"].update(fut["info"])

    # --- Random forest & XGBoost (pooled over the 9 series) --------------
    features_table = None
    for key in ("rf", "xgb"):
        fitted_test = fit_ml(key, train_frame, launch)
        pts, _ = ml_recursive_forecast(fitted_test, train_frame, launch, n_test)
        set_test(key, [sum(pts[c][i] for c in cols) for i in range(n_test)],
                 {"training_rows": int(len(fitted_test["y"])), "features": fitted_test["spec"]["columns"]})
        if key == "rf":
            features_table = {"columns": fitted_test["spec"]["columns"],
                              "rows": [dict(k, **{c: float(v) for c, v in row.items()}, target=float(t))
                                       for k, row, t in zip(fitted_test["keys"],
                                                            fitted_test["X"].to_dict(orient="records"),
                                                            fitted_test["y"])]}
        fitted_full = fit_ml(key, frame, launch)
        pts, trees = ml_recursive_forecast(fitted_full, frame, launch, h, with_trees=(key == "rf"))
        series_forecasts[key] = pts
        level_point = [sum(pts[c][i] for c in cols) for i in range(h)]
        fc = {"point": level_point, "lo80": None, "hi80": None, "lo95": None, "hi95": None}
        if key == "rf":
            col_idx = [SERIES.index(c) for c in cols]
            totals = np.stack([step[:, col_idx].sum(axis=1) for step in trees], axis=1)  # trees x h
            fc.update({"lo80": np.percentile(totals, 10, axis=0), "hi80": np.percentile(totals, 90, axis=0),
                       "lo95": np.percentile(totals, 2.5, axis=0), "hi95": np.percentile(totals, 97.5, axis=0)})
        models[key]["forecast"] = _forecast_block(future_months, fc)
        models[key]["info"].update({
            "training_rows": int(len(fitted_full["y"])), "features": fitted_full["spec"]["columns"],
            "importance": feature_importance(fitted_full["model"], fitted_full["spec"]["columns"]),
            "interval": "tree-spread heuristic (10-90 / 2.5-97.5 percentiles)" if key == "rf" else "none",
        })

    # --- Ranking, ties, skill vs naive ----------------------------------
    ranking = _rank_models(models)
    naive_w = models["naive"]["test"]["metrics"]["wape"]["value"]
    for key, m in models.items():
        if not m["evaluated"]:
            continue
        w = m["test"]["metrics"]["wape"]["value"]
        m["test"]["skill_vs_naive_pct"] = (100.0 * (1.0 - w / naive_w)) if (naive_w and w is not None) else None
        m["test"]["identical_to"] = [
            other for other, o in models.items()
            if other != key and o["evaluated"]
            and np.allclose(o["test"]["predicted"], m["test"]["predicted"], rtol=0, atol=1e-6)]
    best_models = [r["model"] for r in ranking if r["rank"] == 1]

    # --- Distribution plan for the best model ---------------------------
    distribution = None
    if ranking:
        best = ranking[0]["model"]
        if best in series_forecasts:
            cells = {c: series_forecasts[best][c] for c in cols}
            method = "Bottom-up: the model forecasts each region x channel series directly."
        else:
            mix = _last_mix(frame, cols)
            level_fc = models[best]["forecast"]["point"]
            cells = {c: [share * v for v in level_fc] for c, share in mix.items()}
            method = "Split of the level forecast by each series' share of the last 3 months."
        distribution = {"model": best, "label": MODEL_LABELS[best], "method": method,
                        "months": [str(m) for m in future_months],
                        "cells": [{"region": c.split("|")[0], "channel": c.split("|")[1],
                                   "units": [float(v) for v in vals], "total": float(sum(vals))}
                                  for c, vals in cells.items()]}

    tracking = score_tracking(cfg["tracking_log"], level_series, cfg["level"]) if cfg["tracking_log"] else None
    result = {
        "engine_version": ENGINE_VERSION,
        "config": {k: v for k, v in cfg.items() if k != "tracking_log"},
        "meta": {
            "level": cfg["level"], "level_label": level_label(cfg["level"]), "n_months": n,
            "n_train": n_train, "n_test": n_test, "horizon": h,
            "months": [str(m) for m in months], "train_months": [str(m) for m in months[:n_train]],
            "test_months": [str(m) for m in test_months], "future_months": [str(m) for m in future_months],
            "data_through": str(months[-1]), "launch_month": str(launch),
            "first_year_months": int(panel.get("first_year_months", 12)),
            "user_added": list(panel.get("user_added", [])), "user_modified": list(panel.get("user_modified", [])),
            "seasonality_identifiable": bool(n >= SEASONAL_MIN_TRAIN),
            "feature_spec_test": feature_spec(n_train), "feature_spec_forecast": feature_spec(n),
        },
        "actual": {"months": [str(m) for m in months], "units": [float(v) for v in y]},
        "models": models,
        "ranking": ranking,
        "best_models": best_models,
        "distribution": distribution,
        "trend": trend_summary(y, months),
        "seasonality": seasonality_summary(y, months),
        "regions": mix_summary(frame, "region"),
        "channels": mix_summary(frame, "channel"),
        "operations": operations_summary(panel, frame, cols),
        "diagnostics": diagnostics_summary(y, months),
        "features": features_table,
        "tracking": tracking,
    }
    result["new_log_entries"] = forecast_log_entries(result)
    return result


def _r1(x):
    return None if x is None else round_half_up(x, 1)


def _ru(x):
    return None if x is None else int(round_half_up(x, 0))


def fmt_units(x) -> str:
    return "n/a" if x is None else f"{int(x):,}"


def fmt_pct(x, signed: bool = False) -> str:
    if x is None:
        return "n/a"
    return f"{x:+.1f}%" if signed else f"{x:.1f}%"


def build_facts(result: dict) -> dict:
    """Compact, rounded facts that the interpretation (LLM or rules) is allowed to use."""
    meta, trend, seas = result["meta"], result["trend"], result["seasonality"]
    facts = {
        "context": {
            "product": "New flavored water (proxy series: SKU JU-021, a juice, in a synthetic FMCG dataset)",
            "markets": list(REGIONS), "channels": list(CHANNELS),
            "level": meta["level_label"], "level_key": meta["level"],
            "launch_month": meta["launch_month"], "first_full_month": meta["months"][0],
            "data_through": meta["data_through"], "months_of_data": meta["n_months"],
            "months_after_first_year": max(0, meta["n_months"] - meta["first_year_months"]),
            "user_added_months": meta["user_added"], "user_modified_months": meta["user_modified"],
            "seasonality_identifiable": meta["seasonality_identifiable"],
            "months_needed_for_seasonality": SEASONAL_MIN_TRAIN,
        },
        "split": {
            "train_start": meta["train_months"][0], "train_end": meta["train_months"][-1],
            "train_months": meta["n_train"], "test_start": meta["test_months"][0],
            "test_end": meta["test_months"][-1], "test_months": meta["n_test"],
            "horizon_months": meta["horizon"], "forecast_months": meta["future_months"],
        },
        "recent_actuals": [{"month": m, "units": _ru(v)}
                           for m, v in list(zip(result["actual"]["months"], result["actual"]["units"]))[-12:]],
        "trend": {
            "latest_month": trend["latest_month"], "latest_units": _ru(trend["latest_units"]),
            "mom_change_pct": _r1(trend["mom_change_pct"]),
            "last3_avg_units": _ru(trend["last3_avg_units"]), "prev3_avg_units": _ru(trend["prev3_avg_units"]),
            "last3_vs_prev3_pct": _r1(trend["last3_vs_prev3_pct"]),
            "first3_avg_units": _ru(trend["first3_avg_units"]),
            "growth_vs_first3_pct": _r1(trend["growth_vs_first3_pct"]),
            "peak_month": trend["peak_month"], "peak_units": _ru(trend["peak_units"]),
            "low_month": trend["low_month"], "low_units": _ru(trend["low_units"]),
            "yoy_latest_pct": _r1(trend["yoy_latest_pct"]),
        },
        "seasonality": {
            "identifiable": seas["identifiable"],
            "calendar_months_seen_twice": seas["calendar_months_seen_twice"],
            "summer_avg_units": _ru(seas["summer_avg_units"]), "winter_avg_units": _ru(seas["winter_avg_units"]),
            "summer_vs_winter_pct": _r1(seas["summer_vs_winter_pct"]),
        },
        "models": {},
        "ranking": [{"rank": r["rank"], "model": r["model"], "label": r["label"],
                     "wape_pct": _r1(r["wape_pct"]), "mape_pct": _r1(r["mape_pct"])} for r in result["ranking"]],
        "best_models": list(result["best_models"]),
        "regions": [{"region": r["region"], "units_last3": _ru(r["units_last3"]),
                     "share_last3_pct": _r1(r["share_last3_pct"]),
                     "change_last3_vs_prev3_pct": _r1(r["change_last3_vs_prev3_pct"])} for r in result["regions"]],
        "channels": [{"channel": r["channel"], "units_last3": _ru(r["units_last3"]),
                      "share_last3_pct": _r1(r["share_last3_pct"]),
                      "change_last3_vs_prev3_pct": _r1(r["change_last3_vs_prev3_pct"])} for r in result["channels"]],
        "distribution_plan": None,
        "operations": None,
        "tracking": None,
    }
    for key in MODEL_ORDER:
        m = result["models"][key]
        entry = {"label": m["label"], "family": m["family"], "evaluated": m["evaluated"],
                 "not_evaluated_reason": m["not_evaluated_reason"]}
        if m["evaluated"]:
            met = m["test"]["metrics"]
            entry["test"] = {
                "wape_pct": _r1(met["wape"]["value"]), "mape_pct": _r1(met["mape"]["value"]),
                "bias_pct": _r1(met["bias"]["value"]), "abs_error_units": _ru(met["abs_error_units"]),
                "skill_vs_naive_pct": _r1(m["test"]["skill_vs_naive_pct"]),
                "identical_forecasts_to": [MODEL_LABELS[o] for o in m["test"]["identical_to"]],
                "per_month": [{"month": p["month"], "actual": _ru(p["actual"]), "forecast": _ru(p["forecast"])}
                              for p in met["per_month"]],
            }
        if m["forecast"]:
            fc = m["forecast"]
            entry["forecast"] = [
                {"month": fc["months"][i], "units": _ru(fc["point"][i]),
                 "lo80": _ru(fc["lo80"][i]) if fc["lo80"] else None, "hi80": _ru(fc["hi80"][i]) if fc["hi80"] else None,
                 "lo95": _ru(fc["lo95"][i]) if fc["lo95"] else None, "hi95": _ru(fc["hi95"][i]) if fc["hi95"] else None}
                for i in range(len(fc["months"]))]
            entry["forecast_total_units"] = _ru(sum(fc["point"]))
        else:
            entry["forecast"] = None
            entry["forecast_reason"] = m["forecast_reason"]
        if key == "arima" and m["info"].get("label"):
            entry["selected_model"] = m["info"]["label"]
        if key in ("rf", "xgb") and m["info"].get("training_rows"):
            entry["training_rows_test_fit"] = m["info"].get("test_fit", {}).get("training_rows")
            entry["training_rows_forecast_fit"] = m["info"]["training_rows"]
            entry["top_features"] = [d["feature"] for d in m["info"]["importance"][:3]]
            entry["interval"] = m["info"]["interval"]
        facts["models"][key] = entry
    dist = result["distribution"]
    if dist:
        by_region, by_channel = {}, {}
        for c in dist["cells"]:
            by_region[c["region"]] = by_region.get(c["region"], 0.0) + c["total"]
            by_channel[c["channel"]] = by_channel.get(c["channel"], 0.0) + c["total"]
        grand = sum(by_region.values()) or 1.0
        facts["distribution_plan"] = {
            "model": dist["label"], "method": dist["method"], "months": dist["months"],
            "total_units": _ru(grand),
            "by_region": [{"region": k, "units": _ru(v), "share_pct": _r1(100 * v / grand)} for k, v in by_region.items()],
            "by_channel": [{"channel": k, "units": _ru(v), "share_pct": _r1(100 * v / grand)} for k, v in by_channel.items()],
        }
    ops = result["operations"]
    if ops and ops["stockout_rows_last3"] is not None:
        facts["operations"] = {"stockout_rows_last3": _ru(ops["stockout_rows_last3"]),
                               "est_lost_units_last3": _ru(ops["est_lost_units_last3"]),
                               "promo_uplift_ratio": None if ops["promo_uplift_ratio"] is None else round_half_up(ops["promo_uplift_ratio"], 2),
                               "promo_share_pct": _r1(ops["promo_share_pct"])}
    trk = result["tracking"]
    if trk and trk["n_scored"]:
        facts["tracking"] = {"n_scored": trk["n_scored"],
                             "by_model": [{"model": b["model"], "label": b["label"], "n_points": b["n_points"],
                                           "wape_pct": _r1(b["wape_pct"]), "bias_pct": _r1(b["bias_pct"]),
                                           "coverage80_pct": _r1(b["coverage80_pct"])} for b in trk["by_model"]]}
    return facts


def _units_list(fc: list, field: str = "units") -> str:
    return ", ".join(f"{f['month']}: {fmt_units(f[field])}" for f in fc)


def rule_based_interpretation(facts: dict) -> dict:
    """Deterministic interpretation built only from facts (used when the LLM is unavailable)."""
    ctx, tr, se, models, ranking = (facts["context"], facts["trend"], facts["seasonality"],
                                    facts["models"], facts["ranking"])
    n = ctx["months_of_data"]

    # 1. Seasonality & trend ------------------------------------------------
    s1 = [f"The latest month ({tr['latest_month']}) sold {fmt_units(tr['latest_units'])} units"
          + (f" ({fmt_pct(tr['mom_change_pct'], True)} versus the previous month)" if tr["mom_change_pct"] is not None else "") + "."]
    ev1 = ["trend.latest_units", "trend.mom_change_pct"]
    if tr["last3_vs_prev3_pct"] is not None:
        s1.append(f"The last three months averaged {fmt_units(tr['last3_avg_units'])} units, "
                  f"{fmt_pct(tr['last3_vs_prev3_pct'], True)} versus the three months before; "
                  f"the peak so far was {tr['peak_month']} ({fmt_units(tr['peak_units'])} units).")
        ev1 += ["trend.last3_avg_units", "trend.last3_vs_prev3_pct", "trend.peak_units"]
    if se["summer_vs_winter_pct"] is not None:
        s1.append(f"Summer months averaged {fmt_units(se['summer_avg_units'])} units against "
                  f"{fmt_units(se['winter_avg_units'])} in winter ({fmt_pct(se['summer_vs_winter_pct'], True)}).")
        ev1 += ["seasonality.summer_avg_units", "seasonality.winter_avg_units", "seasonality.summer_vs_winter_pct"]
    if not se["identifiable"]:
        s1.append(f"With only {n} months of history, no calendar month has been seen often enough to separate "
                  f"seasonality from the launch ramp-up ({ctx['months_needed_for_seasonality']} months are needed), "
                  "so none of the models could learn the seasonal pattern yet; they extrapolate the recent level or trend.")
        ev1 += ["context.months_of_data", "seasonality.identifiable"]
    else:
        sn = models.get("snaive", {})
        s1.append(f"With {n} months, {se['calendar_months_seen_twice']} calendar months have been observed at least twice, "
                  "so seasonality is now estimable: Seasonal Naive"
                  + (f" (WAPE {fmt_pct(sn['test']['wape_pct'])})" if sn.get("evaluated") else "")
                  + f" and {models['arima'].get('selected_model', 'ARIMA')} use last year's pattern directly.")
        ev1 += ["seasonality.calendar_months_seen_twice", "models.arima.selected_model"]
    if ranking:
        b = models[ranking[0]["model"]]["test"]
        direction = "under" if (b["bias_pct"] or 0) < 0 else "over"
        s1.append(f"On the test window ({facts['split']['test_start']} to {facts['split']['test_end']}) the best model's bias "
                  f"was {fmt_pct(b['bias_pct'], True)}, i.e. it {direction}-forecast that period.")
        ev1.append(f"models.{ranking[0]['model']}.test.bias_pct")

    # 2. Best model & why ---------------------------------------------------
    s2, ev2 = [], []
    if not ranking:
        s2.append("No model could be evaluated on the current test window.")
    else:
        top = [r for r in ranking if r["rank"] == 1]
        top_keys = {r["model"] for r in top}
        lead = top[0]
        if len(top) > 1:
            labels = [r["label"] for r in top]
            joined = labels[0] if len(labels) == 1 else ", ".join(labels[:-1]) + " and " + labels[-1]
            s2.append(joined + f" tie for best with WAPE {fmt_pct(lead['wape_pct'])} "
                      f"(MAPE {fmt_pct(lead['mape_pct'])}) on the {facts['split']['test_months']}-month test window.")
        else:
            s2.append(f"{lead['label']} performed best on the {facts['split']['test_months']}-month test window with "
                      f"WAPE {fmt_pct(lead['wape_pct'])} (MAPE {fmt_pct(lead['mape_pct'])}).")
        ev2 += [f"ranking.0.wape_pct", "ranking.0.mape_pct"]
        ident = models["arima"].get("test", {}).get("identical_forecasts_to", []) if models["arima"]["evaluated"] else []
        if "Naive" in ident and top_keys & {"naive", "arima"}:      # only relevant when they lead
            s2.append(f"ARIMA chose {models['arima'].get('selected_model', 'a random walk')}, a random walk, so its forecasts are identical to Naive.")
            ev2.append("models.arima.test.identical_forecasts_to")
        family = models[lead["model"]]["family"]
        n_train = facts["split"]["train_months"]
        if family in ("baseline", "statistical") and lead["model"] != "snaive":
            ml = [models[k] for k in ("rf", "xgb") if models[k]["evaluated"]]
            if ml:
                biases = [m["test"]["bias_pct"] or 0 for m in ml]
                missed = ("under-forecast" if all(b < 0 for b in biases)
                          else "over-forecast" if all(b > 0 for b in biases) else "missed")
                s2.append(f"With only {n_train} training months the most reliable signal was the latest level. "
                          + " and ".join(f"{m['label']} (WAPE {fmt_pct(m['test']['wape_pct'])}, bias {fmt_pct(m['test']['bias_pct'], True)})" for m in ml)
                          + f" learned from {fmt_units(models['rf'].get('training_rows_test_fit'))} pooled rows but {missed} the test "
                          "window: with so little history they had seen few comparable months, and tree models cannot "
                          "extrapolate beyond the levels they were trained on.")
                ev2 += ["split.train_months", "models.rf.test.wape_pct", "models.xgb.test.wape_pct",
                        "models.rf.training_rows_test_fit"]
        elif lead["model"] == "snaive":
            s2.append("The same month last year was the best guide because the seasonal pattern repeats and the history now covers it.")
        else:
            m = models[lead["model"]]
            s2.append(f"{m['label']} pooled the 9 region-channel series ({fmt_units(m.get('training_rows_test_fit'))} training rows) "
                      f"and combined recent lags with calendar features; its most important inputs were "
                      f"{', '.join(m.get('top_features', []))}.")
            ev2 += [f"models.{lead['model']}.training_rows_test_fit", f"models.{lead['model']}.top_features"]
        skill = models[lead["model"]]["test"]["skill_vs_naive_pct"]
        if "naive" not in top_keys and skill is not None and skill > 0:   # no "better than Naive" when tied with it
            s2.append(f"It is {fmt_pct(skill)} more accurate than the Naive baseline.")
            ev2.append(f"models.{lead['model']}.test.skill_vs_naive_pct")
        worst = ranking[-1]
        if worst["model"] != lead["model"]:
            s2.append(f"{worst['label']} was weakest (WAPE {fmt_pct(worst['wape_pct'])}).")
            ev2.append(f"ranking.{len(ranking) - 1}.wape_pct")

    # 3. Recommendations ----------------------------------------------------
    recs = []
    if ranking:
        lead_key = ranking[0]["model"]
        plan_key = lead_key
        if models[lead_key].get("forecast") and models[lead_key]["forecast"][0]["hi80"] is None:
            plan_key = next((k for k in ("arima", "naive", "snaive", "rf") if models[k].get("forecast")
                             and models[k]["forecast"][0]["hi80"] is not None), lead_key)
        fc = models[lead_key].get("forecast")
        if fc:
            detail = (f"Plan production for {facts['split']['forecast_months'][0]} to {facts['split']['forecast_months'][-1]} "
                      f"around the {models[lead_key]['label']} forecast ({_units_list(fc)}; "
                      f"{fmt_units(models[lead_key]['forecast_total_units'])} units in total).")
            ev = [f"models.{lead_key}.forecast", f"models.{lead_key}.forecast_total_units"]
            pfc = models[plan_key].get("forecast")
            if pfc and pfc[0]["hi80"] is not None:
                detail += (f" Keep capacity or stock up to the {models[plan_key]['label']} 80% upper bound "
                           f"({_units_list(pfc, 'hi80')}) so a demand surprise does not cause stockouts.")
                ev.append(f"models.{plan_key}.forecast")
            recs.append({"title": "Production volume and buffer", "detail": detail, "evidence": ev})
    dp = facts.get("distribution_plan")
    if dp:
        regions = "; ".join(f"{r['region']} {fmt_units(r['units'])} units ({fmt_pct(r['share_pct'])})" for r in dp["by_region"])
        channels = "; ".join(f"{c['channel']} {fmt_pct(c['share_pct'])}" for c in dp["by_channel"])
        recs.append({"title": "Regional and channel allocation",
                     "detail": f"Allocate the {fmt_units(dp['total_units'])} planned units by region: {regions}. By channel: {channels}.",
                     "evidence": ["distribution_plan.by_region", "distribution_plan.by_channel", "distribution_plan.total_units"]})
    ops = facts.get("operations")
    if ops:
        text = (f"Stockouts cost an estimated {fmt_units(ops['est_lost_units_last3'])} units in the last three months "
                f"({fmt_units(ops['stockout_rows_last3'])} store-days out of stock); raise safety stock before peak months.")
        ev = ["operations.est_lost_units_last3", "operations.stockout_rows_last3"]
        if ops.get("promo_uplift_ratio"):
            text += (f" Promotion days sell {ops['promo_uplift_ratio']}x a normal day, so use promotions to lift off-season "
                     "demand rather than to add to the summer peak.")
            ev.append("operations.promo_uplift_ratio")
        recs.append({"title": "Availability and promotions", "detail": text, "evidence": ev})
    if not se["identifiable"]:
        recs.append({"title": "Re-forecast monthly",
                     "detail": (f"Re-run the forecast every month as actuals arrive (data currently runs to {ctx['data_through']}). "
                                f"Until {ctx['months_needed_for_seasonality']} months exist, use the simple model as the planning "
                                "baseline and treat machine-learning outputs as a cross-check."),
                     "evidence": ["context.data_through", "context.months_needed_for_seasonality"]})
    else:
        recs.append({"title": "Use the seasonal pattern",
                     "detail": ("Seasonality is now estimable: build stock ahead of the summer peak using the seasonal models, "
                                "and keep re-forecasting monthly."),
                     "evidence": ["seasonality.identifiable"]})
    trk = facts.get("tracking")
    if trk and trk["by_model"]:
        bt = min(trk["by_model"], key=lambda b: b["wape_pct"] if b["wape_pct"] is not None else 1e9)
        detail = (f"Across {trk['n_scored']} forecasts already scored against actuals, {bt['label']} has the "
                  f"lowest tracked WAPE ({fmt_pct(bt['wape_pct'])} over {bt['n_points']} forecasts).")
        if ranking and bt["model"] != ranking[0]["model"]:
            detail += (f" The latest test window favours {ranking[0]['label']} while the longer record favours "
                       f"{bt['label']}, so averaging the two forecasts is a sensible hedge.")
        recs.append({"title": "Trust the track record", "detail": detail,
                     "evidence": ["tracking.n_scored", "tracking.by_model"]})

    test_months = facts["split"]["test_months"]
    caveats = ["Synthetic data: SKU JU-021 (a juice) stands in for the flavored water, so patterns are illustrative.",
               (f"Short history: {n} months of data and a {test_months}-month test window make error estimates noisy."
                if not se["identifiable"] else
                f"Small test window: a single {test_months}-month test can rank models differently from their longer track record."),
               "Random Forest's range is a heuristic spread of its trees and XGBoost has no uncertainty range."]
    if ctx["user_added_months"] or ctx["user_modified_months"]:
        caveats.append("Includes user-entered or edited months: "
                       + ", ".join(sorted(set(ctx["user_added_months"]) | set(ctx["user_modified_months"]))) + ".")
    return {"seasonality_trend": {"answer": " ".join(s1), "evidence": ev1},
            "best_model": {"answer": " ".join(s2), "evidence": ev2},
            "recommendations": recs, "caveats": caveats}


_DATE_PATTERN = r"\b(?:19|20)\d{2}-(?:0[1-9]|1[0-2])(?:-\d{2})?\b"
_CODE_PATTERN = r"\b[A-Z]{2}-\d{3}\b"
_NUMBER_PATTERN = r"(?<![A-Za-z_\d.])[+\-−]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?"


def _numeric_leaves(obj, out: set):
    if isinstance(obj, bool) or obj is None:
        return
    if isinstance(obj, (int, float)):
        out.add(float(obj))
    elif isinstance(obj, dict):
        for v in obj.values():
            _numeric_leaves(v, out)
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            _numeric_leaves(v, out)


def _path_exists(facts: dict, path: str) -> bool:
    node = facts
    for part in path.split("."):
        if isinstance(node, dict) and part in node:
            node = node[part]
        elif isinstance(node, list) and part.isdigit() and int(part) < len(node):
            node = node[int(part)]
        else:
            return False
    return True


def _texts(interp: dict) -> list:
    out = [interp["seasonality_trend"]["answer"], interp["best_model"]["answer"]]
    for r in interp["recommendations"]:
        out += [r["title"], r["detail"]]
    return out + list(interp["caveats"])


def _matches(token: str, known: set) -> bool:
    raw = token.replace(",", "").replace("−", "-").lstrip("+")
    value = float(raw)
    decimals = len(raw.split(".")[1]) if "." in raw else 0
    if decimals == 0 and float(value).is_integer() and (0 <= abs(value) <= 24 or 2020 <= value <= 2030 or abs(value) in (80, 95, 100)):
        return True
    candidates = known | {abs(k) for k in known}
    for f in candidates:
        if round_half_up(f, decimals) == abs(value) or round_half_up(f, decimals) == value:
            return True
        if decimals == 0:
            digits = raw.lstrip("-")
            zeros = len(digits) - len(digits.rstrip("0"))
            for k in range(1, min(zeros, 3) + 1):
                if abs(f) >= 10 ** k and round_half_up(abs(f), -k) == abs(value):
                    return True
    return False


def grounding_check(interp: dict, facts: dict) -> dict:
    """Every number in the interpretation must come from the facts; evidence keys must exist."""
    import re
    known = set()
    _numeric_leaves(facts, known)
    unverified = []
    checked = 0
    for text in _texts(interp):
        clean = re.sub(_DATE_PATTERN, " ", text)
        clean = re.sub(_CODE_PATTERN, " ", clean)
        for token in re.findall(_NUMBER_PATTERN, clean):
            checked += 1
            if not _matches(token, known):
                unverified.append(token)
    keys = [interp["seasonality_trend"]["evidence"], interp["best_model"]["evidence"]] + \
           [r["evidence"] for r in interp["recommendations"]]
    bad_keys = sorted({k for group in keys for k in group if not _path_exists(facts, k)})
    return {"numbers_checked": checked, "unverified_numbers": unverified, "invalid_evidence_keys": bad_keys,
            "passed": not unverified and not bad_keys}


def to_jsonable(obj):
    """Convert numpy / pandas values to plain JSON types; NaN and infinity become None."""
    if isinstance(obj, dict):
        return {str(k): to_jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [to_jsonable(v) for v in obj]
    if isinstance(obj, np.ndarray):
        return [to_jsonable(v) for v in obj.tolist()]
    if isinstance(obj, (np.bool_, bool)):
        return bool(obj)
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating, float)):
        value = float(obj)
        return value if math.isfinite(value) else None
    if isinstance(obj, pd.Period):
        return str(obj)
    return obj


def analyze(panel: dict, config=None) -> dict:
    result = run_scenario(panel, config)
    facts = build_facts(result)
    fallback = rule_based_interpretation(facts)
    return to_jsonable({"result": result, "facts": facts, "rule_based": fallback,
                        "rule_based_grounding": grounding_check(fallback, facts)})


def analyze_json(panel_json: str, config_json: str = "{}") -> str:
    return json.dumps(analyze(json.loads(panel_json), json.loads(config_json)), allow_nan=False)
