"""Shared fixtures: the exported engine module, the data panel and the notebook snapshot."""
import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
ENGINE_PATH = ROOT / "app" / "public" / "engine" / "forecast_core.py"
PANEL_PATH = ROOT / "app" / "public" / "data" / "ju021_panel.json"
SNAPSHOT_PATH = ROOT / "app" / "public" / "data" / "snapshot.json"
PROMPT_PATH = ROOT / "app" / "netlify" / "lib" / "interpretation-prompt.json"


@pytest.fixture(scope="session")
def core():
    """Import the generated engine exactly as the browser receives it (fresh module namespace)."""
    spec = importlib.util.spec_from_file_location("forecast_core", ENGINE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="session")
def panel():
    return json.loads(PANEL_PATH.read_text(encoding="utf-8"))


@pytest.fixture(scope="session")
def first_year(core, panel):
    return core.slice_panel(panel, panel["first_year_months"])


@pytest.fixture(scope="session")
def snapshot():
    return json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8"))


@pytest.fixture(scope="session")
def default_analysis(core, first_year):
    return core.analyze(first_year, {"level": "total", "test_size": 3, "horizon": 3})
