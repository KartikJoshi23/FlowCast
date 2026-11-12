import { useMemo } from "react";
import { create } from "zustand";
import { buildWorkingPanel, NO_EDITS, nextMonth, type DataEdits, type SeriesValues } from "../data/panel";
import { ENGINE_URL, loadStaticData } from "../data/staticData";
import { MODEL_KEYS, type Analysis, type LogEntry, type ModelKey, type Panel, type ScenarioConfig, type Snapshot } from "../data/types";
import { CancelledError, EngineClient, type EngineStatus } from "../engine/engineClient";
import { compareJson, type ParityReport } from "../engine/parity";
import { fmtMonth, fmtUnits } from "../lib/format";

export interface ParityState {
  status: "pending" | "pass" | "fail";
  report: ParityReport | null;
  /** The engine file served differs from the one the snapshot was made with. */
  snapshotStale: boolean;
}

/** Scenario settings the user can change (everything except the tracking log). */
export type ScenarioSettings = Omit<ScenarioConfig, "tracking_log">;

export interface ChangeLogEntry {
  at: string;
  kind: "feed" | "add" | "edit" | "import" | "reset";
  text: string;
}

/** Pause between months while the live feed plays (after each recompute finishes). */
export const FEED_STEP_MS = 2200;
const MAX_LOG_ENTRIES = 3000;

interface AppState {
  panel: Panel | null;
  snapshot: Snapshot | null;
  loadError: string | null;
  /** Dataset months currently revealed (first year = 12; the rest arrive through the feed). */
  revealed: number;
  edits: DataEdits;
  config: ScenarioSettings;
  engine: EngineStatus;
  parity: ParityState;
  analysis: Analysis | null;
  source: "snapshot" | "engine";
  computing: boolean;
  runMs: number | null;
  runError: string | null;
  /** Every forecast made so far, scored by the engine once its actual month arrives. */
  trackingLog: LogEntry[];
  changeLog: ChangeLogEntry[];
  feedPlaying: boolean;
  visibleModels: Record<ModelKey, boolean>;
  focusModel: ModelKey;

  boot: () => Promise<void>;
  setConfig: (patch: Partial<ScenarioSettings>) => void;
  toggleModel: (key: ModelKey) => void;
  setFocusModel: (key: ModelKey) => void;
  recompute: () => Promise<void>;
  /** Reveal the next held-back month (the company's next monthly sales close). */
  revealNext: () => Promise<void>;
  playFeed: () => void;
  pauseFeed: () => void;
  /** Add the month after the current last month with user-entered values. */
  addMonth: (series: SeriesValues, note?: string) => Promise<void>;
  /** What-if edit of one series in an existing month. */
  editValue: (month: string, seriesKey: string, units: number) => Promise<void>;
  /** Apply several edits/additions at once (CSV upload). */
  importMonths: (rows: { month: string; series: SeriesValues; action: "edit" | "add" }[], fileName: string) => Promise<void>;
  resetData: () => Promise<void>;
}

const initialEngine: EngineStatus = { phase: "idle", stage: "", fraction: 0, info: null, error: null, restarts: 0 };
const allVisible = Object.fromEntries(MODEL_KEYS.map((k) => [k, true])) as Record<ModelKey, boolean>;
const total = (series: SeriesValues) => Object.values(series).reduce((a, b) => a + b, 0);

/** Append new forecasts, keeping one copy per (origin, level, model, target). */
function mergeLog(log: LogEntry[], entries: LogEntry[]): LogEntry[] {
  const key = (e: LogEntry) => `${e.origin}|${e.level}|${e.model}|${e.target}`;
  const fresh = new Set(entries.map(key));
  return [...log.filter((e) => !fresh.has(key(e))), ...entries].slice(-MAX_LOG_ENTRIES);
}

export const useApp = create<AppState>()((set, get) => {
  const engine = new EngineClient(ENGINE_URL, (status) => set({ engine: status }));
  let booted = false;
  let feedTimer: ReturnType<typeof setTimeout> | null = null;

  /** The data the company has right now (feed position + user edits). */
  const workingPanel = (): Panel | null => {
    const { panel, revealed, edits } = get();
    return panel ? buildWorkingPanel(panel, revealed, edits) : null;
  };

  const logChange = (kind: ChangeLogEntry["kind"], text: string) =>
    set({ changeLog: [{ at: new Date().toISOString(), kind, text }, ...get().changeLog].slice(0, 200) });

  /** Run the engine on the current data + settings (latest request wins) and record its forecasts. */
  const runCurrent = async (): Promise<Analysis | null> => {
    const data = workingPanel();
    if (!data) return null;
    set({ computing: true, runError: null });
    try {
      const { analysis, ms } = await engine.run(data, { ...get().config, tracking_log: get().trackingLog });
      set({
        analysis,
        source: "engine",
        runMs: ms,
        computing: false,
        trackingLog: mergeLog(get().trackingLog, analysis.result.new_log_entries),
      });
      return analysis;
    } catch (error) {
      if (error instanceof CancelledError) return null;
      set({ computing: false, runError: error instanceof Error ? error.message : String(error) });
      return null;
    }
  };

  const canChangeData = () => get().engine.phase === "ready";

  /** First live run: recompute the default first-year scenario and compare with the notebook. */
  const verifyAgainstNotebook = async () => {
    const { snapshot } = get();
    if (!snapshot) return;
    const analysis = await runCurrent();
    if (!analysis) return;
    const report = compareJson(analysis, snapshot.default);
    set({ parity: { ...get().parity, status: report.pass ? "pass" : "fail", report } });
  };

  const scheduleFeedStep = () => {
    if (feedTimer) clearTimeout(feedTimer);
    feedTimer = setTimeout(async () => {
      feedTimer = null;
      const { feedPlaying, panel, revealed } = get();
      if (!feedPlaying || !panel) return;
      if (revealed >= panel.months.length) {
        set({ feedPlaying: false });
        return;
      }
      await get().revealNext();
      if (get().feedPlaying) scheduleFeedStep();
    }, FEED_STEP_MS);
  };

  return {
    panel: null,
    snapshot: null,
    loadError: null,
    revealed: 12,
    edits: NO_EDITS,
    config: { level: "total", test_size: 3, horizon: 3, arima_order: null },
    engine: initialEngine,
    parity: { status: "pending", report: null, snapshotStale: false },
    analysis: null,
    source: "snapshot",
    computing: false,
    runMs: null,
    runError: null,
    trackingLog: [],
    changeLog: [],
    feedPlaying: false,
    visibleModels: allVisible,
    focusModel: "arima",

    boot: async () => {
      if (booted) return;
      booted = true;
      try {
        const { panel, snapshot } = await loadStaticData();
        set({
          panel,
          snapshot,
          revealed: panel.first_year_months,
          config: { ...snapshot.default_config },
          analysis: snapshot.default,          // instant first view from the notebook snapshot
          source: "snapshot",
        });
      } catch (error) {
        set({ loadError: error instanceof Error ? error.message : String(error) });
        return;
      }
      try {
        const info = await engine.start();
        const expected = get().snapshot?.engine_sha256;
        set({ parity: { ...get().parity, snapshotStale: Boolean(expected) && expected !== info.engineSha256 } });
        await verifyAgainstNotebook();
      } catch {
        // Engine failure is already reflected in `engine.phase`; the snapshot stays on screen.
      }
    },

    setConfig: (patch) => {
      set({ config: { ...get().config, ...patch } });
      if (canChangeData()) void runCurrent();
    },

    toggleModel: (key) => set({ visibleModels: { ...get().visibleModels, [key]: !get().visibleModels[key] } }),

    setFocusModel: (key) => set({ focusModel: key }),

    recompute: async () => {
      await runCurrent();
    },

    revealNext: async () => {
      const { panel, revealed } = get();
      if (!panel || !canChangeData() || revealed >= panel.months.length) return;
      const month = panel.months[revealed];
      set({ revealed: revealed + 1 });
      const units = Object.values(panel.series).reduce((a, s) => a + s[revealed], 0);
      logChange("feed", `${fmtMonth(month)} sales closed: ${fmtUnits(units)} units arrived from the feed.`);
      await runCurrent();
    },

    playFeed: () => {
      const { panel, revealed } = get();
      if (!panel || !canChangeData() || revealed >= panel.months.length) return;
      set({ feedPlaying: true });
      void get().revealNext().then(() => {
        if (get().feedPlaying) scheduleFeedStep();
      });
    },

    pauseFeed: () => {
      if (feedTimer) clearTimeout(feedTimer);
      feedTimer = null;
      set({ feedPlaying: false });
    },

    addMonth: async (series, note) => {
      const { panel, revealed, edits } = get();
      if (!panel || !canChangeData()) return;
      const current = buildWorkingPanel(panel, revealed, edits);
      const month = nextMonth(current.months[current.months.length - 1]);
      if (revealed < panel.months.length && panel.months[revealed] === month) {
        // The dataset has this month: the user's values replace it (entered instead of fed).
        set({
          revealed: revealed + 1,
          edits: { ...edits, overrides: { ...edits.overrides, [month]: series }, added: [...edits.added, month] },
        });
      } else {
        set({ edits: { ...edits, extra: [...edits.extra, { month, series }], added: [...edits.added, month] } });
      }
      logChange("add", `${fmtMonth(month)} added by hand: ${fmtUnits(total(series))} units${note ? ` (${note})` : ""}.`);
      await runCurrent();
    },

    editValue: async (month, seriesKey, units) => {
      const { edits } = get();
      if (!canChangeData()) return;
      const isExtra = edits.extra.some((r) => r.month === month);
      const next: DataEdits = isExtra
        ? { ...edits, extra: edits.extra.map((r) => (r.month === month ? { ...r, series: { ...r.series, [seriesKey]: units } } : r)) }
        : {
            ...edits,
            overrides: { ...edits.overrides, [month]: { ...(edits.overrides[month] ?? {}), [seriesKey]: units } },
            modified: edits.added.includes(month) || edits.modified.includes(month) ? edits.modified : [...edits.modified, month],
          };
      set({ edits: next });
      logChange("edit", `${fmtMonth(month)} · ${seriesKey.replace("|", " · ")} set to ${fmtUnits(units)} units.`);
      await runCurrent();
    },

    importMonths: async (rows, fileName) => {
      const { panel } = get();
      if (!panel || !canChangeData() || !rows.length) return;
      let { revealed, edits } = get();
      for (const row of rows) {
        if (row.action === "edit") {
          const isExtra = edits.extra.some((r) => r.month === row.month);
          edits = isExtra
            ? { ...edits, extra: edits.extra.map((r) => (r.month === row.month ? { ...r, series: row.series } : r)) }
            : {
                ...edits,
                overrides: { ...edits.overrides, [row.month]: row.series },
                modified: edits.added.includes(row.month) || edits.modified.includes(row.month) ? edits.modified : [...edits.modified, row.month],
              };
        } else if (revealed < panel.months.length && panel.months[revealed] === row.month) {
          revealed += 1;
          edits = { ...edits, overrides: { ...edits.overrides, [row.month]: row.series }, added: [...edits.added, row.month] };
        } else {
          edits = { ...edits, extra: [...edits.extra, { month: row.month, series: row.series }], added: [...edits.added, row.month] };
        }
      }
      set({ revealed, edits });
      const adds = rows.filter((r) => r.action === "add").length;
      logChange("import", `${fileName}: ${rows.length - adds} month(s) edited, ${adds} added.`);
      await runCurrent();
    },

    resetData: async () => {
      const { panel } = get();
      if (!panel) return;
      get().pauseFeed();
      set({ revealed: panel.first_year_months, edits: NO_EDITS, trackingLog: [], changeLog: [] });
      logChange("reset", "Data reset to the first year; forecast tracking cleared.");
      if (canChangeData()) await runCurrent();
    },
  };
});

/** Settings and data can change only when the live engine is ready (the snapshot covers the default only). */
export const useCanCompute = () => useApp((s) => s.engine.phase === "ready");

/** The working data as currently seen by the engine (for tables and downloads). */
export const useWorkingPanel = () => {
  const panel = useApp((s) => s.panel);
  const revealed = useApp((s) => s.revealed);
  const edits = useApp((s) => s.edits);
  return useMemo(() => (panel ? buildWorkingPanel(panel, revealed, edits) : null), [panel, revealed, edits]);
};
