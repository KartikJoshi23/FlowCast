# FlowCast: monthly demand forecasting for a new flavored-water product

MAIB · AI in Operations · Session II lab activity: *Forecasting Monthly Sales for a New Beverage Product*.

FlowCast forecasts the monthly sales of a newly launched flavored water with five models and evaluates them with **MAPE** and **WAPE**. An **LLM interprets the results from the data as it stands at that moment**.

It has two deliverables:

| Deliverable | Where |
|---|---|
| Jupyter notebook covering all 7 slide tasks plus the LLM interpretation | [`notebooks/beverage_demand_forecasting.ipynb`](notebooks/beverage_demand_forecasting.ipynb) |
| Interactive React dashboard (Netlify) that runs the same pipeline live | [`app/`](app/) |

> **Data.** Kaggle *FMCG Daily Sales Data (2022–2024)* by Beata Faron, **CC0 Public Domain**, synthetic. Its only beverage product, SKU **JU-021** (a juice launched on 11 Jul 2022 in 3 regions × 3 channels), stands in for the new flavored water.
>
> - **First year:** Aug 2022 – Jul 2023. The partial launch month is excluded.
> - **Held back:** the following 17 months, which arrive later as "real-time" data.

---

## What the slide asks, and where it is answered

| Slide requirement | Notebook | Dashboard |
|---|---|---|
| Task 1: preprocess, lag features, seasonal indicators | §3, §5, §6 | Feature Engineering |
| Task 2: choose a model (Naive, ARIMA, ML) | §7 | Model toggles; Scoreboard |
| Task 3: train/test with an appropriate (chronological) split | §8, §10 | Test-window control; shaded test window |
| Task 4: forecast the next 3 months | §11 | Horizon control (1–6); Forecast Lab; Command Center |
| Task 5: MAPE and WAPE | §9 (with a hand-calculation check), §10 | Scoreboard and "Show the math" |
| Task 6: plot actual vs predicted | §10, §11, §13 | Forecast Lab, Command Center |
| Task 7: seasonality and trends · best model and why · recommendations | §12, §15, §16 | AI Interpretation; Trend & Seasonality |
| Must add an LLM interpretation based on real-time data | §13, §15 | Data & Live Feed + AI Interpretation, which regenerates whenever the data changes |

**Models:** Naive, Seasonal Naive, ARIMA (order chosen by AICc), Random Forest, XGBoost.
- All five are scored on the same chronological split and the same horizon.
- The two ML models are pooled over the 9 region × channel series.

**Headline results.**

| When | Best model | Why |
|---|---|---|
| Year one (9 training months, May–Jul 2023 test) | **Naive = ARIMA(0,1,0)**, WAPE 13.8% (MAPE 13.7%) | Seasonality cannot be learned from one cycle |
| After 29 months (Oct–Dec 2024 test) | **Seasonal Naive**, WAPE 1.4%; seasonal ARIMA 1.6% | Two cycles make seasonality learnable |
| Over 48 tracked forecasts per model | **Random Forest**, tracked WAPE 14.8% | Pooling the series pays off as history grows |

---

## How it works

```
Notebook (Python 3.14, libraries pinned = Pyodide 314.0.7)
  cells tagged "core"   --scripts/export_engine.py-->  app/public/engine/forecast_core.py
  cell tagged "prompt"  ------------------------------>  app/netlify/lib/interpretation-prompt.json
  section 17            ------------------------------>  app/public/data/{ju021_panel,snapshot}.json

Browser (static site on Netlify)
  React + TypeScript UI  <->  Web Worker running Pyodide + forecast_core.py   (all models, metrics, facts)
                         ->  POST /api/interpret (facts only)

Netlify Function /api/interpret (TypeScript)
  validate facts (allowlist) -> cache / rate limit / daily cap -> Claude (key from a secret env var)
  -> grounding check (every number must exist in the facts) -> JSON
  If no key, an error or a rate limit: the dashboard shows the engine's rule-based interpretation, labelled.
```

- **Exact parity with the notebook.** The dashboard runs the notebook's own Python code in the browser, with the same library versions. On load it recomputes the first-year scenario and checks every number against the notebook's snapshot: **Verified** badge, max deviation 2.9 × 10⁻⁶.
- **Precomputed.** Only `snapshot.json`, used for the instant first view and as the parity reference. Everything on screen is recomputed live.
- **"Real-time data".**
  - The 17 held-back months arrive one at a time (*Close month* / *Play feed*). You can also add, edit or upload (CSV) months.
  - Every change retrains all models and scores earlier forecasts against the new actuals.
  - The LLM interpretation is regenerated from the new facts. While the feed is playing it waits, and refreshes when you pause.
- **API key safety.** The key exists only as a Netlify environment variable read by the function. The browser sends only validated numeric facts, never prompt text.

## Repository layout

```
notebooks/beverage_demand_forecasting.ipynb   the analysis (single source of the engine and prompt)
Dataset/FMCG_2022_2024.csv                     Kaggle data (CC0)
scripts/export_engine.py                       notebook -> engine, prompt, snapshot fingerprint
scripts/make_llm_fixtures.py                   shared test fixtures (Python reference for the TS code)
tests/python/                                  pytest: metrics, leakage, parity, interpretation
app/                                           dashboard (Vite + React 19 + TypeScript)
  src/engine/        Pyodide worker, engine client, parity check
  src/pages/         Command Center, Forecast Lab, Scoreboard, Trend & Seasonality,
                     Feature Engineering, Data & Live Feed, AI Interpretation, Verification
  src/charts/        ECharts builders (validated colour-blind-safe palette)
  netlify/functions/interpret.mts              the LLM endpoint
  netlify/lib/                                 validation, grounding, provider, limits, handler (+ tests)
  scripts/pyodide-parity.mjs                   WebAssembly <-> notebook parity check
docs/                                          Phase 2 plan (with audit), verification record
netlify.toml                                   build, function, security headers
```

## Run locally

Requirements: Python 3.14 (via [uv](https://docs.astral.sh/uv/)) and Node 22+.

1. **Notebook.**
   ```bash
   uv venv .venv --python 3.14
   uv pip install --python .venv -r requirements.txt
   ```
   Open the notebook with the `.venv` kernel and run all cells (about 1 minute).
   - **LLM:** set `ANTHROPIC_API_KEY` in your environment to get Claude's interpretation. Without it, the notebook uses the labelled rule-based fallback.
   - **Colab:** the notebook also runs in Colab (it downloads the data with `kagglehub`), with possible last-decimal differences.
2. **Export for the dashboard** (only needed after changing the notebook):
   ```bash
   python scripts/export_engine.py
   python scripts/make_llm_fixtures.py
   ```
3. **Dashboard:**
   ```bash
   cd app
   npm ci
   npm run dev
   ```
   Then open http://localhost:5173. The engine downloads about 40 MB from jsDelivr on the first visit; later visits load it from the browser cache.
4. **Dashboard + LLM function, production build:**
   ```bash
   npx netlify-cli serve
   ```
   Run it from the project root, then open http://localhost:8888. To use the LLM locally, copy `app/.env.example` to `app/.env` and set your key; `.env` is git-ignored.

## Tests

```bash
.venv/Scripts/python -m pytest tests/python
cd app && npm test
cd app && npm run parity
cd app && npm run build
```

| Command | What it checks |
|---|---|
| `pytest tests/python` | 31 tests: metrics, leakage, notebook parity, grounding |
| `npm test` | 102 tests: UI logic, charts, LLM function, validation, grounding parity with Python |
| `npm run parity` | The engine on WebAssembly vs the notebook (default scenario + 18 replay steps) |
| `npm run build` | Typecheck + production build |

See [`docs/VERIFICATION.md`](docs/VERIFICATION.md) for the results.

## Deploy to Netlify (via GitHub)

1. **Create a GitHub repository** (private is fine) and push this folder:
   ```bash
   git init
   git add .
   git commit -m "FlowCast"
   git branch -M main
   git remote add origin <your-repo-url>
   git push -u origin main
   ```
2. **Import it into Netlify:** *Add new project → Import an existing project → GitHub*, then pick the repository. `netlify.toml` supplies everything:
   - base `app`
   - build `npm run build`
   - publish `dist`
   - functions `netlify/functions`
   - Node 22
   - security headers
3. **Add the LLM key** (optional; without it the rule-based interpretation is shown) under *Project configuration → Environment variables → Add a variable*:
   - `ANTHROPIC_API_KEY`: tick **Contains secret values**, scope **Functions**, contexts **Production** and **Deploy Previews**.
   - Optional: `LLM_MODEL` (default `claude-opus-5-5`; e.g. `claude-haiku-5-5` costs far less), `LLM_DAILY_CAP` (default 200), `LLM_PER_MINUTE` (default 6).
   - Then **Deploys → Trigger deploy**: environment variables apply to new deploys only.
4. **Check the live site:**
   - The status bar reaches *Engine verified · matches notebook*.
   - *AI Interpretation* shows "LLM · claude-…" with all figures verified.
   - *Close Aug 2023* updates every view.
5. **Mind the credits.** On Netlify's credit-based Free plan each production deploy costs 15 of the 300 monthly credits, while deploy previews are free. Pyodide loads from jsDelivr, so it uses no Netlify bandwidth.

## Notes

- **Windows.** The npm scripts call each tool's Node entry point directly, because the project path contains `&`, which breaks npm's `.cmd` shims on Windows. Netlify builds on Linux are unaffected.
- **Day 10 of RDMU.** The slide's pointer for LLM integration was not in the course folders, so the standard secure pattern was used: a server-side key, facts-only input, a grounding check and a fallback.
