import type { Panel, Snapshot } from "./types";

/** Paths of the files exported by the notebook (served from /public). */
export const PANEL_URL = "/data/ju021_panel.json";
export const SNAPSHOT_URL = "/data/snapshot.json";
export const ENGINE_URL = "/engine/forecast_core.py";

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`Could not load ${url} (HTTP ${response.status}).`);
  }
  return (await response.json()) as T;
}

export async function loadStaticData(): Promise<{ panel: Panel; snapshot: Snapshot }> {
  const [panel, snapshot] = await Promise.all([getJson<Panel>(PANEL_URL), getJson<Snapshot>(SNAPSHOT_URL)]);
  if (!panel.months?.length || !snapshot.default?.result) {
    throw new Error("The data files are incomplete. Re-run the notebook and scripts/export_engine.py.");
  }
  return { panel, snapshot };
}
