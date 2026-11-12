/**
 * Python forecasting engine in a Web Worker.
 *
 * Loads Pyodide (CPython compiled to WebAssembly) from jsDelivr, installs the same scientific
 * libraries the notebook uses, then imports forecast_core.py, the code exported from the
 * notebook's "core" cells. Every scenario is computed by calling analyze_json(), so the
 * dashboard runs the notebook's own code and the UI thread is never blocked.
 */
import type { PyodideInterface } from "pyodide";
import { ENGINE_PACKAGES, PYODIDE_INDEX_URL, PYODIDE_VERSION, type WorkerRequest, type WorkerResponse } from "./protocol";

interface WorkerScope {
  postMessage(message: WorkerResponse): void;
  addEventListener(type: "message", listener: (event: MessageEvent<WorkerRequest>) => void): void;
}
const scope = self as unknown as WorkerScope;

type AnalyzeFn = (panelJson: string, configJson: string) => string;
let analyzeJson: AnalyzeFn | null = null;
let initPromise: Promise<void> | null = null;

const post = (message: WorkerResponse) => scope.postMessage(message);
const progress = (stage: string, fraction: number) => post({ type: "progress", stage, fraction });

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Last line of a Python traceback is the useful part for the UI. */
function cleanError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const lines = text.trim().split("\n").filter(Boolean);
  return lines[lines.length - 1] ?? "Unknown engine error";
}

async function initialise(engineUrl: string): Promise<void> {
  const started = performance.now();
  progress("Downloading the Python runtime", 0.05);
  const module = (await import(/* @vite-ignore */ `${PYODIDE_INDEX_URL}pyodide.mjs`)) as {
    loadPyodide: (options: { indexURL: string }) => Promise<PyodideInterface>;
  };
  const pyodide = await module.loadPyodide({ indexURL: PYODIDE_INDEX_URL });

  progress("Loading numpy, pandas, SciPy, scikit-learn, statsmodels and XGBoost (first visit only)", 0.2);
  let loaded = 0;
  await pyodide.loadPackage(ENGINE_PACKAGES, {
    messageCallback: (msg: string) => {
      if (msg.startsWith("Loaded")) {
        loaded += 1;
        progress("Scientific libraries loaded", Math.min(0.9, 0.2 + 0.7 * (loaded / 2)));
      }
    },
    errorCallback: (msg: string) => progress(`Package warning: ${msg}`, 0.5),
  });

  progress("Loading the forecasting engine", 0.92);
  const response = await fetch(engineUrl, { cache: "no-cache" });
  if (!response.ok) throw new Error(`Could not load the engine (HTTP ${response.status}).`);
  const code = await response.text();
  const engineSha256 = await sha256Hex(code);
  pyodide.FS.writeFile("/home/pyodide/forecast_core.py", code);
  const core = pyodide.pyimport("forecast_core");
  analyzeJson = core.analyze_json as AnalyzeFn;

  const libraries = JSON.parse(
    pyodide.runPython(
      "import json, numpy, pandas, scipy, sklearn, statsmodels, xgboost\n" +
        "json.dumps({'numpy': numpy.__version__, 'pandas': pandas.__version__, 'scipy': scipy.__version__, " +
        "'scikit-learn': sklearn.__version__, 'statsmodels': statsmodels.__version__, 'xgboost': xgboost.__version__})",
    ) as string,
  ) as Record<string, string>;

  post({
    type: "ready",
    pyodideVersion: PYODIDE_VERSION,
    engineVersion: String(core.ENGINE_VERSION),
    engineSha256,
    libraries,
    loadMs: performance.now() - started,
  });
}

scope.addEventListener("message", (event) => {
  const request = event.data;
  if (request.type === "init") {
    initPromise ??= initialise(request.engineUrl).catch((error: unknown) => {
      post({ type: "error", id: null, message: cleanError(error), fatal: true });
      throw error;
    });
    return;
  }
  if (request.type === "run") {
    const run = async () => {
      if (!initPromise) throw new Error("The engine was not initialised.");
      await initPromise;
      if (!analyzeJson) throw new Error("The engine is not available.");
      const started = performance.now();
      const json = analyzeJson(request.panelJson, request.configJson);
      post({ type: "result", id: request.id, json, ms: performance.now() - started });
    };
    run().catch((error: unknown) => post({ type: "error", id: request.id, message: cleanError(error), fatal: false }));
  }
});
