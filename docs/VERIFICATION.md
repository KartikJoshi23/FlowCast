# Verification record

All checks were run on 12 Nov 2026 against the final code.
- **Notebook environment:** Python 3.14.6 with numpy 2.4.6, pandas 3.0.2, scipy 1.18.0, scikit-learn 1.8.0, statsmodels 0.14.6, xgboost 2.1.4. These are identical to Pyodide 314.0.7.
- **Dashboard toolchain:** Node 22.21, TypeScript 7.0.2, Vite 8.3.5.

## 1. Notebook

| Check | Result |
|---|---|
| Runs top to bottom (nbclient, fresh kernel) | **Pass**: 90 cells, about 1 minute, no errors |
| Numbers quoted in the text are asserted in code (e.g. Naive WAPE 13.84%, tracked WAPE 14.8%, Q1 2025 forecast 2,799 / 2,871 / 3,957) | **Pass**: every assertion holds |
| Hand calculation of MAPE/WAPE (Naive, May–Jul 2023) | **Pass**: MAPE (10.47 + 18.30 + 12.37) / 3 = **13.71%**; WAPE 2,391 / 17,274 = **13.84%** |
| No look-ahead: every `lag_1` equals the previous month's actual; test predictions unchanged when test actuals change | **Pass** |
| LLM section without an API key | **Pass**: labelled rule-based fallback, every figure verified by the grounding check |
| Grounding check catches invented figures | **Pass**: "12,345" and "47.3" flagged, plus an unknown evidence key |

## 2. Python tests (`pytest tests/python`)

**31 passed.**

| Area | What is tested |
|---|---|
| Metrics | Hand-calculated values; a zero actual excluded from MAPE; all-zero actuals give n/a; near-zero warning; bias sign; half-up rounding |
| Features and split | Availability rules (lags at 12 months, `lag_12` at 24); feature rows use only history; 63 pooled rows; leakage test; chronological split; invalid configs and panels rejected |
| Engine parity | The exported `forecast_core.py` reproduces the notebook snapshot: the full default analysis and all 18 replay steps. The fingerprint matches |
| Interpretation | The rule-based text is fully grounded at 5 levels and data sizes; tampering is caught; honest rounding is allowed; user edits are disclosed; the prompt export is strict |

## 3. Browser engine (WebAssembly) vs notebook (`npm run parity`)

| Scenario | Numbers compared | Max deviation | Result |
|---|---|---|---|
| Default first-year analysis (result, facts, rule-based text) | 1,525 | 2.9 × 10⁻⁶ (the AICc of a rejected ARIMA candidate) | **Pass** |
| Real-time replay, 18 steps (test predictions, metrics, forecasts, ranges) | all | 5.5 × 10⁻⁷ | **Pass** |

Tolerances:
- 10⁻⁶ relative (absolute below 1);
- 10⁻⁴ on ARIMA fields, because the maximum-likelihood optimiser can stop a few millionths apart on WebAssembly.

The same comparison also runs live in every visitor's browser (the *Engine verified* badge).

## 4. Dashboard unit tests (`npm test`)

**135 passed** across 12 files:

| Area | What is tested |
|---|---|
| Panel helpers | Slicing; working data with edits; total split |
| CSV | Import and export round trip; validation errors |
| Parity comparator | Tolerance rules; structural mismatches |
| Engine client | Latest request wins; worker crash, restart and give-up |
| Charts | Option builders on the real snapshot; hidden models; uncertainty layers |
| "Show the math" | Reproduces 2,391 / 17,274 |
| LLM client | Job polling; status check; fallback codes; cancellation |
| LLM function | See the next table |

LLM function details:

| Topic | Tests |
|---|---|
| Facts allowlist | Accepts all 7 real facts documents; rejects injected text, unknown keys, oversized or non-finite input |
| Grounding check | TypeScript and Python agree on all 11 shared cases |
| Request handler | Background jobs (202 + job id, polling, signed run token, failed-run reporting, direct-call fallback); cache; per-minute limit; daily cap; origin check; missing key; storage failure; every provider error mapped to an HTTP status |
| NVIDIA provider (free) | OpenAI-compatible request with the notebook prompt and guided JSON; key only in the header; retry without guided JSON; skip retired, failing or slow models within the time budget; stop at once on a rejected key; JSON inside reasoning text; auth, rate-limit, error, bad-JSON and truncation mapping |
| Claude provider | Request shape (prompt, structured output, effort, refusal-fallback beta); retry without the beta; refusal, truncation and bad JSON; SDK error mapping |

## 5. Production build in a browser (`netlify serve`)

`netlify serve` is the production build with the function and the security headers.

| Check | Result |
|---|---|
| Netlify build | Typecheck, Vite build and function bundling succeed |
| Security headers (CSP with only `'wasm-unsafe-eval'` + jsDelivr, nosniff, referrer and permissions policies) | Served. **The Python engine loads and verifies under this CSP** |
| First view | Instant from the snapshot. The engine loads in about 15 s on the first visit (40 MB, cached afterwards); each recompute takes about 1–2.5 s |
| All 8 views render (Command Center, Forecast Lab, Scoreboard, Trend & Seasonality, Feature Engineering, Data & Live Feed, AI Interpretation, Verification) | **Pass**, with no horizontal scroll at 1280 × 720 |
| Console | **No errors or warnings** in the production build |
| Live feed | *Close Aug 2023* retrains all models and scores July's forecasts (Seasonal Naive 2.1% off). Play/Pause advanced to Apr 2024 (24 forecasts scored per model). The interpretation waited while playing and refreshed on pause |
| Settings | The horizon change (6 months) and the level change (PL-North) recompute, with rapid clicks coalesced into one run |
| LLM endpoint without a key | `GET` reports `configured: false` (never the key); the page shows the labelled rule-based interpretation; no failed requests in the console |
| Endpoint hardening | Foreign origin → 403; injected text in the facts → 422 "unexpected text value" |

## 6. Live LLM on the deployed site (https://flowcastai.netlify.app)

With a free `NVIDIA_API_KEY` set in Netlify:

| Check | Result |
|---|---|
| `GET /api/interpret` | `configured: true`, provider `nvidia`; the key is never returned |
| Request flow | `POST` answers **202** with a job id in about 1–2 s; the background function asks five NVIDIA models in parallel; the page polls until the result is stored |
| 29-month scenario | Answer from `nvidia/nemotron-3.5-lightning-30b-a3b` in about 22 s; **grounding passed: 42 figures checked, none unverified, no invalid evidence keys** |
| Grounding check catches a weak answer | An earlier first-year answer quoted "1500", which is not in the facts, and some invalid evidence keys. The check flagged them, and the server now prefers an answer that passes the check (waiting up to 45 s for one) |
| First-year scenario (the dashboard's opening view) | Answer in about 20 s; **51 figures checked, all verified, no invalid evidence keys** (after the models were given the list of valid evidence keys) |
| Real-time loop in the browser | *Close Aug 2023* → a new LLM interpretation for 13 months of data; **all 46 figures verified** |
| Console on the live site | Clean (the only error was from Netlify's own deploy-toolbar snippet; it is now allowed by its exact hash in the CSP) |
| Why a background function | Free NVIDIA endpoints took more than 25 s, which a synchronous function cannot wait for. A background function can run for up to 15 minutes |

## 7. Final audit

Audit of the whole project after deployment. Every fix has a test.

| Area | Finding | Fix |
|---|---|---|
| Notebook LLM route | `re` was never imported at module level, so parsing any real NVIDIA answer would have crashed | Imported. A simulated NVIDIA server test ran the real notebook through 5 scenarios: grounded answer wins; grounded beats faster flawed; plain retry after HTTP 400; flawed-only is used and flagged; all-fail lists every model's reason |
| Notebook LLM route | Models were tried one by one, using slow schema-guided JSON; a timeout on the first model ended the whole call; the model that answered live was missing from the list | Same approach as the dashboard: all five models in parallel (threads), speed options, valid evidence keys in the prompt, first fully grounded answer wins |
| Regenerate button | It returned the server's cached answer instead of a new one | Sends `fresh: true`; the server skips the cache (still rate-limited and capped) |
| Background jobs | A finished job stayed marked "pending" for 6 minutes, so a new run for the same facts could not start | A finished run marks its job "done" |
| LLM status check | One failed check (e.g. during a deploy) kept the page on the rule-based text until a reload | Only definite answers are remembered; failures are re-checked next time |
| Error messages | A crashed function was reported as "not running here (static preview)" | Reported as "service failed (HTTP n)" |
| Job token | Plain SHA-256 of secret + job id | HMAC-SHA256 |
| Streaming reader | A last stream line without a trailing newline was ignored | Read at end of stream |
| AI Interpretation page | The "data has changed" note ignored a change of market level; no hint about waiting time | Both added ("free models can take up to a minute") |
| Secrets | Repository, full git history and built site scanned for API keys and personal data | None found |

After the fixes:
- **Notebook:** 42 code cells run with no errors.
- **Tests:** pytest 31 passed; dashboard tests 135 passed.
- **Parity:** WebAssembly parity PASS, with the same maximum deviations as section 3.
- **Build:** the production build passes.

## 8. Not verifiable here

**A live Claude call.** No `ANTHROPIC_API_KEY` is configured, so the Claude path is covered by mocked tests only. The NVIDIA path was tested live (section 6).

After deploying with the key:
- open *AI Interpretation* and confirm the source badge reads "LLM · <model name>" (or the model you set);
- confirm the grounding badge reads "All N figures verified".
