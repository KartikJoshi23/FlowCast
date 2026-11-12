"""Feature availability rules, no-leakage guarantees and input validation."""
import copy

import numpy as np
import pandas as pd
import pytest


def test_feature_availability_rules(core):
    assert core.feature_spec(9)["numeric"][:2] == ["lag_1", "lag_2"]
    assert "lag_3" not in core.feature_spec(11)["numeric"]
    assert {"lag_3", "rolling_mean_3"} <= set(core.feature_spec(12)["numeric"])
    assert "lag_12" not in core.feature_spec(23)["numeric"]
    assert "lag_12" in core.feature_spec(24)["numeric"]


def test_feature_row_uses_only_history(core):
    spec = core.feature_spec(9)
    launch = pd.Period("2022-07", freq="M")
    row = core.feature_row([100.0, 200.0], pd.Period("2022-10", freq="M"), "PL-North|Retail", spec, launch)
    assert row["lag_1"] == 200.0 and row["lag_2"] == 100.0
    assert row["months_since_launch"] == 3 and row["is_summer"] == 0.0 and row["days_in_month"] == 31
    assert row["region=PL-North"] == 1.0 and row["channel=Retail"] == 1.0 and row["region=PL-South"] == 0.0
    empty = core.feature_row([], pd.Period("2022-08", freq="M"), "PL-North|Retail", spec, launch)
    assert np.isnan(empty["lag_1"])


def test_pooled_training_rows_first_year(core, first_year):
    frame = core.panel_frame(first_year).iloc[:9]
    X, y, keys = core.build_training_set(frame, core.feature_spec(9), pd.Period("2022-07", freq="M"))
    assert len(X) == 63 and len(y) == 63          # 9 series x 7 months with lag_1 and lag_2


def test_test_predictions_do_not_depend_on_test_actuals(core, first_year):
    """Changing the test-window actuals must not change any model's test-window predictions."""
    base = core.run_scenario(first_year)
    altered = copy.deepcopy(first_year)
    for key in altered["series"]:
        altered["series"][key][-3:] = [v * 3 for v in altered["series"][key][-3:]]
    changed = core.run_scenario(altered)
    for model in core.MODEL_ORDER:
        if base["models"][model]["evaluated"]:
            assert base["models"][model]["test"]["predicted"] == changed["models"][model]["test"]["predicted"]


def test_chronological_split(core, default_analysis):
    meta = default_analysis["result"]["meta"]
    assert meta["train_months"][-1] < meta["test_months"][0]
    assert meta["test_months"] == ["2023-05", "2023-06", "2023-07"]
    assert meta["future_months"] == ["2023-08", "2023-09", "2023-10"]


@pytest.mark.parametrize("config, message", [
    ({"test_size": 0}, "test_size"), ({"horizon": 7}, "horizon"), ({"level": "region:Mars"}, "level"),
    ({"test_size": 6, "arima_order": [3, 1, 0]}, "ARIMA"),
])
def test_invalid_config_is_rejected(core, first_year, config, message):
    with pytest.raises(ValueError, match=message):
        core.run_scenario(first_year, config)


def test_too_few_training_months_rejected(core, panel):
    with pytest.raises(ValueError, match="training months"):
        core.run_scenario(core.slice_panel(panel, 8), {"test_size": 3})


def test_panel_validation(core, first_year):
    gap = copy.deepcopy(first_year)
    gap["months"][5] = "2025-01"
    with pytest.raises(ValueError):
        core.panel_frame(gap)
    negative = copy.deepcopy(first_year)
    negative["series"]["PL-North|Retail"][0] = -5
    with pytest.raises(ValueError, match="negative"):
        core.panel_frame(negative)
