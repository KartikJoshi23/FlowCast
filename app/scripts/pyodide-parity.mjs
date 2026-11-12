/**
 * Notebook <-> WebAssembly parity check (run with `npm run parity`).
 *
 * Runs the exported engine (public/engine/forecast_core.py) inside Pyodide 314.0.7 under Node,
 * the same WebAssembly Python the dashboard uses in the browser, and compares every number
 * with the notebook's snapshot:
 *   - the full default first-year analysis (result, facts, rule-based interpretation);
 *   - all 18 real-time replay steps (test predictions, metrics, forecasts and ranges).
 */
import { readFile } from "node:fs/promises";
import { loadPyodide } from "pyodide";
import { ARIMA_TOLERANCE, compareJson, DEFAULT_TOLERANCE } from "../src/engine/parity.ts";
import { ENGINE_PACKAGES } from "../src/engine/protocol.ts";

const ROOT = new URL("../", import.meta.url);
const readJson = async (path) => JSON.parse(await readFile(new URL(path, ROOT), "utf8"));

const panel = await readJson("public/data/ju021_panel.json");
const snapshot = await readJson("public/data/snapshot.json");
const code = await readFile(new URL("public/engine/forecast_core.py", ROOT), "utf8");

const started = performance.now();
const pyodide = await loadPyodide();
await pyodide.loadPackage(ENGINE_PACKAGES, { messageCallback: () => {} });
pyodide.FS.writeFile("/home/pyodide/forecast_core.py", code);
const core = pyodide.pyimport("forecast_core");
console.log(`Pyodide ${pyodide.version} ready in ${((performance.now() - started) / 1000).toFixed(1)}s`);

const analyze = (p, config) => JSON.parse(core.analyze_json(JSON.stringify(p), JSON.stringify(config)));

// Slice with the engine's own slice_panel(), exactly as the notebook does.
pyodide.globals.set("PANEL_JSON", JSON.stringify(panel));
const pySlice = pyodide.runPython(
  "import json, forecast_core\n_panel = json.loads(PANEL_JSON)\n" +
  "def _slice(n):\n    return json.dumps(forecast_core.slice_panel(_panel, n))\n_slice",
);
const slicePanel = (_unused, n) => JSON.parse(pySlice(n));

// 1. Default first-year scenario: every field of the analysis.
let t = performance.now();
const live = analyze(slicePanel(panel, panel.first_year_months), snapshot.default_config);
const defaultMs = performance.now() - t;
const defaultReport = compareJson(live, snapshot.default);

// 2. Real-time replay: same compact numbers the notebook exported.
const compact = (step) => ({
  data_through: step.meta.data_through,
  n_months: step.meta.n_months,
  best_models: step.best_models,
  models: Object.fromEntries(
    Object.entries(step.models).map(([key, m]) => [key, {
      evaluated: m.evaluated,
      test_predicted: m.evaluated ? m.test.predicted : null,
      mape: m.evaluated ? m.test.metrics.mape.value : null,
      wape: m.evaluated ? m.test.metrics.wape.value : null,
      bias: m.evaluated ? m.test.metrics.bias.value : null,
      forecast: m.forecast,
      arima_label: key === "arima" ? (m.info.label ?? null) : null,
    }]),
  ),
});
let log = [];
let worst = { maxDeviation: 0, worstPath: null };
let replayPass = true;
t = performance.now();
for (const expected of snapshot.replay) {
  const step = analyze(slicePanel(panel, expected.n_months), { ...snapshot.default_config, tracking_log: log }).result;
  log = log.concat(step.new_log_entries);
  const report = compareJson(compact(step), expected);
  if (!report.pass) {
    replayPass = false;
    console.log(`  replay ${expected.data_through}: MISMATCH`, report.mismatches.slice(0, 5));
  }
  if (report.maxDeviation > worst.maxDeviation) worst = { maxDeviation: report.maxDeviation, worstPath: `${expected.data_through}.${report.worstPath}` };
}
const replayMs = performance.now() - t;

console.log(`\nTolerance: ${DEFAULT_TOLERANCE} (relative; absolute below 1), ARIMA fields ${ARIMA_TOLERANCE}`);
console.log(`Default scenario: ${defaultReport.pass ? "PASS" : "FAIL"} - ${defaultReport.compared} numbers, ` +
  `max deviation ${defaultReport.maxDeviation.toExponential(2)} at ${defaultReport.worstPath}, computed in ${(defaultMs / 1000).toFixed(2)}s`);
if (!defaultReport.pass) console.log(defaultReport.mismatches.slice(0, 10));
console.log(`Replay (${snapshot.replay.length} steps): ${replayPass ? "PASS" : "FAIL"} - max deviation ` +
  `${worst.maxDeviation.toExponential(2)} at ${worst.worstPath}, ${(replayMs / snapshot.replay.length / 1000).toFixed(2)}s per step`);
process.exit(defaultReport.pass && replayPass ? 0 : 1);
