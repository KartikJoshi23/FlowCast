"""Export the dashboard engine and the LLM prompt from the notebook (the single source of truth).

What it does
------------
1. Concatenates the notebook's code cells tagged ``core`` into ``app/public/engine/forecast_core.py``.
   The dashboard's Web Worker runs this exact file in Pyodide, so the dashboard and the notebook
   share one implementation.
2. Evaluates the cell tagged ``prompt`` (pure literals) and writes the system prompt, user template
   and JSON output schema to ``app/netlify/lib/interpretation-prompt.json`` for the
   server-side LLM function.
3. Stamps the engine's SHA-256 fingerprint into ``app/public/data/snapshot.json`` so the dashboard
   (and pytest) can detect a stale snapshot.

Usage (from the project root, after running the notebook):
    python scripts/export_engine.py
"""
import ast
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NOTEBOOK = ROOT / "notebooks" / "beverage_demand_forecasting.ipynb"
ENGINE_OUT = ROOT / "app" / "public" / "engine" / "forecast_core.py"
PROMPT_OUT = ROOT / "app" / "netlify" / "lib" / "interpretation-prompt.json"
SNAPSHOT = ROOT / "app" / "public" / "data" / "snapshot.json"

HEADER = '''"""Forecasting engine for the beverage-demand dashboard.

GENERATED FILE - do not edit by hand.
Source: notebooks/beverage_demand_forecasting.ipynb (code cells tagged "core").
Regenerate with:  python scripts/export_engine.py
"""
'''


def cells_with_tag(notebook: dict, tag: str) -> list:
    return ["".join(cell["source"]).strip() for cell in notebook["cells"]
            if cell["cell_type"] == "code" and tag in cell.get("metadata", {}).get("tags", [])]


def main() -> None:
    notebook = json.loads(NOTEBOOK.read_text(encoding="utf-8"))

    core = cells_with_tag(notebook, "core")
    if not core:
        sys.exit("No cells tagged 'core' were found in the notebook.")
    source = HEADER + "\n\n" + "\n\n\n".join(core) + "\n"
    ast.parse(source)                                   # fail early on a syntax error
    ENGINE_OUT.parent.mkdir(parents=True, exist_ok=True)
    ENGINE_OUT.write_bytes(source.encode("utf-8"))      # LF line endings -> stable fingerprint
    sha = hashlib.sha256(ENGINE_OUT.read_bytes()).hexdigest()

    prompt_cells = cells_with_tag(notebook, "prompt")
    if len(prompt_cells) != 1:
        sys.exit(f"Expected exactly one cell tagged 'prompt', found {len(prompt_cells)}.")
    namespace: dict = {}
    exec(compile(prompt_cells[0], "<prompt cell>", "exec"), namespace)   # literals only
    prompt = {
        "source": "Generated from notebooks/beverage_demand_forecasting.ipynb (cell tagged 'prompt'). Do not edit.",
        "system_prompt": namespace["SYSTEM_PROMPT"],
        "user_template": namespace["USER_TEMPLATE"],
        "output_schema": namespace["OUTPUT_SCHEMA"],
    }
    PROMPT_OUT.parent.mkdir(parents=True, exist_ok=True)
    PROMPT_OUT.write_bytes((json.dumps(prompt, indent=2, ensure_ascii=False) + "\n").encode("utf-8"))

    if not SNAPSHOT.is_file():
        sys.exit("snapshot.json not found - run the notebook first (section 17 writes it).")
    snapshot = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    snapshot["engine_sha256"] = sha
    SNAPSHOT.write_bytes(json.dumps(snapshot, separators=(",", ":"), allow_nan=False).encode("utf-8"))

    print(f"engine   -> {ENGINE_OUT.relative_to(ROOT)} ({len(core)} core cells, {ENGINE_OUT.stat().st_size / 1024:.1f} KB)")
    print(f"prompt   -> {PROMPT_OUT.relative_to(ROOT)}")
    print(f"snapshot -> engine_sha256 = {sha[:16]}...")


if __name__ == "__main__":
    main()
