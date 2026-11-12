"""Generate the shared LLM test fixtures from the exported engine (Python is the reference).

Writes app/netlify/lib/__fixtures__/llm-fixtures.json with:
  - facts documents for a spread of scenarios (levels, data sizes, test windows, ARIMA override,
    tracking record, user-edited data): the server's input validator must accept all of them;
  - grounding cases (rule-based interpretations plus deliberately tampered ones) with the Python
    grounding_check() verdicts: the TypeScript port must reproduce every verdict exactly.

Usage (from the project root):  python scripts/make_llm_fixtures.py
"""
import copy
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENGINE = ROOT / "app" / "public" / "engine" / "forecast_core.py"
PANEL = ROOT / "app" / "public" / "data" / "ju021_panel.json"
OUT = ROOT / "app" / "netlify" / "lib" / "__fixtures__" / "llm-fixtures.json"


def load_engine():
    spec = importlib.util.spec_from_file_location("forecast_core", ENGINE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> None:
    core = load_engine()
    panel = json.loads(PANEL.read_text(encoding="utf-8"))

    scenarios = [
        ("first year, total", 12, {"level": "total"}),
        ("first year, region", 12, {"level": "region:PL-North"}),
        ("15 months, channel, 2-month test", 15, {"level": "channel:Retail", "test_size": 2, "horizon": 4}),
        ("24 months, manual ARIMA", 24, {"level": "total", "arima_order": [1, 1, 0]}),
        ("26 months, 6-month horizon", 26, {"level": "region:PL-South", "horizon": 6, "test_size": 4}),
    ]
    samples = []
    for name, n, config in scenarios:
        out = core.analyze(core.slice_panel(panel, n), config)
        samples.append({"name": name, "facts": out["facts"], "rule_based": out["rule_based"]})

    # Full replay with a tracking record, so tracking facts are covered too.
    log = []
    for n in range(12, len(panel["months"]) + 1):
        result = core.run_scenario(core.slice_panel(panel, n), {"tracking_log": log})
        log += result["new_log_entries"]
    final = core.analyze(core.slice_panel(panel, len(panel["months"])), {"tracking_log": log})
    samples.append({"name": "29 months with tracking", "facts": final["facts"], "rule_based": final["rule_based"]})

    # User-edited data (disclosed in facts and caveats).
    edited = core.slice_panel(panel, 13)
    edited["user_added"] = ["2023-08"]
    edited["series"]["PL-North|Retail"][12] = 0
    out = core.analyze(edited)
    samples.append({"name": "user-added month with a zero", "facts": out["facts"], "rule_based": out["rule_based"]})

    # Grounding cases: genuine interpretations plus tampered variants.
    base_facts = samples[0]["facts"]
    base = samples[0]["rule_based"]
    variants = []
    for sample in samples:
        variants.append((f"rule-based: {sample['name']}", sample["rule_based"], sample["facts"]))
    tampered = copy.deepcopy(base)
    tampered["best_model"]["answer"] += " It would have saved 12,345 units and cut errors by 47.3%."
    variants.append(("invented numbers", tampered, base_facts))
    bad_key = copy.deepcopy(base)
    bad_key["recommendations"][0]["evidence"] = ["models.naive.test.profit_eur", "ranking.9.wape_pct"]
    variants.append(("invalid evidence keys", bad_key, base_facts))
    rounding = copy.deepcopy(base)
    rounding["seasonality_trend"]["answer"] = (
        "Peak about 6,100 units (6,072 exactly) in 2023-06; 24 months needed; bias 13.8% below actual; "
        "WAPE roughly 14% vs 13.84% precise; 1.92x promotion uplift; 80% range; Q3 2023.")
    variants.append(("rounding, dates and small counts", rounding, base_facts))
    signs = copy.deepcopy(base)
    signs["best_model"]["answer"] = "Bias was −13.8% and +32.6% growth; a +7.7% change is not in the facts."
    variants.append(("unicode minus and plus signs", signs, base_facts))

    cases = [{"name": name, "interpretation": interp, "facts_index": None, "facts": facts,
              "expected": core.grounding_check(interp, facts)} for name, interp, facts in variants]

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(core.to_jsonable({"facts_samples": samples, "grounding_cases": cases}),
                              ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(samples)} facts samples, {len(cases)} grounding cases "
          f"({OUT.stat().st_size / 1024:.0f} KB)")
    for c in cases:
        e = c["expected"]
        print(f"  {c['name']:<45} passed={e['passed']} unverified={e['unverified_numbers']} bad_keys={e['invalid_evidence_keys']}")


if __name__ == "__main__":
    main()
