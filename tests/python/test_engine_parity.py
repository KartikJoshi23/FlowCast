"""The exported engine must reproduce the notebook's snapshot exactly (the dashboard parity reference)."""
import hashlib
import json
import math

from conftest import ENGINE_PATH


def _close(a, b, path="root"):
    """Deep equality with a tiny relative tolerance for floats."""
    if isinstance(a, float) or isinstance(b, float):
        assert a is not None and b is not None, f"{path}: {a} vs {b}"
        assert math.isclose(a, b, rel_tol=1e-9, abs_tol=1e-9), f"{path}: {a} vs {b}"
    elif isinstance(a, dict):
        assert set(a) == set(b), f"{path}: keys differ {set(a) ^ set(b)}"
        for k in a:
            _close(a[k], b[k], f"{path}.{k}")
    elif isinstance(a, list):
        assert len(a) == len(b), f"{path}: length {len(a)} vs {len(b)}"
        for i, (x, y) in enumerate(zip(a, b)):
            _close(x, y, f"{path}[{i}]")
    else:
        assert a == b, f"{path}: {a!r} vs {b!r}"


def test_snapshot_fingerprint_matches_engine(snapshot):
    assert snapshot["engine_sha256"] == hashlib.sha256(ENGINE_PATH.read_bytes()).hexdigest()
    assert snapshot["pyodide_version"] == "314.0.7"


def test_default_scenario_matches_snapshot(default_analysis, snapshot):
    _close(json.loads(json.dumps(default_analysis)), snapshot["default"])


def test_replay_matches_snapshot(core, panel, snapshot):
    log = []
    for expected in snapshot["replay"]:
        step = core.run_scenario(core.slice_panel(panel, expected["n_months"]),
                                 {"level": "total", "test_size": 3, "horizon": 3, "tracking_log": log})
        log += step["new_log_entries"]
        assert step["meta"]["data_through"] == expected["data_through"]
        assert step["best_models"] == expected["best_models"]
        for key, exp in expected["models"].items():
            m = step["models"][key]
            assert m["evaluated"] == exp["evaluated"]
            if m["evaluated"]:
                _close(m["test"]["predicted"], exp["test_predicted"], f"{expected['data_through']}.{key}.test")
                _close(m["test"]["metrics"]["wape"]["value"], exp["wape"])
                _close(m["test"]["metrics"]["mape"]["value"], exp["mape"])
            _close(core.to_jsonable(m["forecast"]), exp["forecast"], f"{expected['data_through']}.{key}.forecast")


def test_json_entry_point_is_valid_json(core, first_year):
    text = core.analyze_json(json.dumps(first_year), json.dumps({"level": "channel:Retail"}))
    data = json.loads(text)                       # allow_nan=False upstream: NaN would have raised
    assert set(data) == {"result", "facts", "rule_based", "rule_based_grounding"}
    assert data["result"]["meta"]["level"] == "channel:Retail"
