/** Messages exchanged between the UI thread and the Python engine worker. */

export const PYODIDE_VERSION = "314.0.7";
export const PYODIDE_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
export const ENGINE_PACKAGES = ["numpy", "pandas", "scipy", "scikit-learn", "statsmodels", "xgboost"];

export type WorkerRequest =
  | { type: "init"; engineUrl: string }
  | { type: "run"; id: number; panelJson: string; configJson: string };

export interface EngineReadyInfo {
  pyodideVersion: string;
  engineVersion: string;
  engineSha256: string;
  libraries: Record<string, string>;
  loadMs: number;
}

export type WorkerResponse =
  | { type: "progress"; stage: string; fraction: number }
  | ({ type: "ready" } & EngineReadyInfo)
  | { type: "result"; id: number; json: string; ms: number }
  | { type: "error"; id: number | null; message: string; fatal: boolean };
