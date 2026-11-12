"""Facts, rule-based fallback, grounding check and the exported prompt."""
import copy
import json

import pytest

from conftest import PROMPT_PATH


@pytest.mark.parametrize("n_months, level", [(12, "total"), (15, "total"), (24, "region:PL-North"), (29, "total"),
                                             (29, "channel:E-commerce")])
def test_rule_based_interpretation_is_fully_grounded(core, panel, n_months, level):
    out = core.analyze(core.slice_panel(panel, n_months), {"level": level})
    check = out["rule_based_grounding"]
    assert check["passed"], check
    assert check["numbers_checked"] > 20
    interp = out["rule_based"]
    assert interp["seasonality_trend"]["answer"] and interp["best_model"]["answer"]
    assert 3 <= len(interp["recommendations"]) <= 6 and interp["caveats"]


def test_grounding_flags_invented_numbers_and_keys(core, default_analysis):
    facts = default_analysis["facts"]
    tampered = copy.deepcopy(default_analysis["rule_based"])
    tampered["best_model"]["answer"] += " It saves 12,345 units and 47.3% of cost."
    tampered["recommendations"][0]["evidence"].append("models.naive.test.profit")
    check = core.grounding_check(tampered, facts)
    assert not check["passed"]
    assert {"12,345", "47.3"} <= set(check["unverified_numbers"])
    assert check["invalid_evidence_keys"] == ["models.naive.test.profit"]


def test_grounding_allows_rounding_dates_and_small_counts(core, default_analysis):
    facts = default_analysis["facts"]                     # contains 6,072 (peak) and 13.8 (WAPE)
    text = {"seasonality_trend": {"answer": "About 6,100 units at the 2023-06 peak; 24 months needed.", "evidence": []},
            "best_model": {"answer": "WAPE 13.8% (about 14%); bias 13.8% below actual.", "evidence": ["ranking.0.wape_pct"]},
            "recommendations": [{"title": "Plan", "detail": "Re-forecast every 1 month for 3 months.", "evidence": []}],
            "caveats": ["Data for 2022 to 2024."]}
    check = core.grounding_check(text, facts)
    assert check["passed"], check


def test_facts_contain_first_year_story(default_analysis):
    f = default_analysis["facts"]
    assert f["context"]["months_of_data"] == 12 and f["context"]["seasonality_identifiable"] is False
    assert f["best_models"] == ["naive", "arima"]
    assert f["models"]["arima"]["test"]["identical_forecasts_to"] == ["Naive"]
    assert f["models"]["snaive"]["evaluated"] is False and f["models"]["snaive"]["not_evaluated_reason"]
    assert f["models"]["naive"]["test"]["wape_pct"] == 13.8 and f["models"]["naive"]["test"]["mape_pct"] == 13.7


def test_user_edits_are_disclosed(core, first_year):
    edited = copy.deepcopy(first_year)
    edited["user_modified"] = ["2023-06"]
    edited["series"]["PL-North|Retail"][10] += 50
    out = core.analyze(edited)
    assert out["facts"]["context"]["user_modified_months"] == ["2023-06"]
    assert any("2023-06" in c for c in out["rule_based"]["caveats"])
    assert out["rule_based_grounding"]["passed"]


def test_exported_prompt_is_strict(core):
    prompt = json.loads(PROMPT_PATH.read_text(encoding="utf-8"))
    assert "Use only numbers that appear in FACTS" in prompt["system_prompt"]
    assert "{facts_json}" in prompt["user_template"]
    schema = prompt["output_schema"]
    assert schema["additionalProperties"] is False
    assert set(schema["required"]) == {"seasonality_trend", "best_model", "recommendations", "caveats"}
