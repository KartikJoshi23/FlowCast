"""MAPE / WAPE / bias: hand-calculated values and edge cases."""
import pytest

ACTUAL = [5541, 6072, 5661]          # first-year test window (May-Jul 2023)
NAIVE = [4961, 4961, 4961]           # last training month carried forward


def test_hand_calculation_naive_test_window(core):
    # |A-F| = 580, 1111, 700 -> APE = 10.467%, 18.297%, 12.365% -> MAPE 13.71%
    # WAPE = 2391 / 17274 = 13.84%
    assert core.mape(ACTUAL, NAIVE)["value"] == pytest.approx(13.7099, abs=1e-3)
    assert core.wape(ACTUAL, NAIVE)["value"] == pytest.approx(100 * 2391 / 17274, abs=1e-9)
    assert core.bias(ACTUAL, NAIVE)["value"] == pytest.approx(-100 * 2391 / 17274, abs=1e-9)
    ev = core.evaluate_forecast(ACTUAL, NAIVE, ["2023-05", "2023-06", "2023-07"])
    assert ev["abs_error_units"] == 2391
    assert [p["abs_error"] for p in ev["per_month"]] == [580, 1111, 700]


def test_zero_actual_is_excluded_from_mape_not_wape(core):
    m = core.mape([0, 100, 200], [10, 110, 190])
    assert m["n_excluded_zero"] == 1 and m["n_used"] == 2
    assert m["value"] == pytest.approx(100 * (0.10 + 0.05) / 2)
    assert core.wape([0, 100, 200], [10, 110, 190])["value"] == pytest.approx(100 * 30 / 300)


def test_all_zero_actuals_are_undefined(core):
    assert core.mape([0, 0], [1, 2])["value"] is None
    assert core.wape([0, 0], [1, 2])["value"] is None
    assert core.bias([0, 0], [1, 2])["value"] is None
    assert core.mape([0, 0], [1, 2])["reason"]


def test_near_zero_actual_raises_warning(core):
    assert core.mape([2, 100, 200], [10, 110, 190])["near_zero_warning"] is True
    assert core.mape(ACTUAL, NAIVE)["near_zero_warning"] is False


def test_perfect_forecast_and_bias_sign(core):
    assert core.wape([100, 200], [100, 200])["value"] == 0
    assert core.bias([100, 100], [110, 110])["value"] == pytest.approx(10.0)    # over-forecast
    assert core.bias([100, 100], [90, 90])["value"] == pytest.approx(-10.0)     # under-forecast


def test_round_half_up_matches_dashboard_rule(core):
    assert core.round_half_up(13.75, 1) == 13.8
    assert core.round_half_up(2.5, 0) == 3.0
    assert core.round_half_up(6072, -2) == 6100.0
    assert core.round_half_up(None, 1) is None
