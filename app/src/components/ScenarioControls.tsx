import { CHANNELS, MODEL_KEYS, REGIONS, type Level, type ModelKey } from "../data/types";
import { fmtDuration } from "../lib/format";
import { MODEL_META } from "../lib/models";
import { useApp, useCanCompute } from "../state/store";
import { Spinner } from "./icons";

const MIN_TRAIN_MONTHS = 6;   // mirrors the engine's rule
const MAX_STEP = 6;

const levelOptions: { value: Level; label: string }[] = [
  { value: "total", label: "Total (all markets)" },
  ...REGIONS.map((r) => ({ value: `region:${r}` as Level, label: `Region · ${r}` })),
  ...CHANNELS.map((c) => ({ value: `channel:${c}` as Level, label: `Channel · ${c}` })),
];

const selectClass =
  "rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[13px] text-ink-1 outline-none transition-colors " +
  "hover:border-white/20 focus-visible:border-accent/60 disabled:cursor-not-allowed disabled:opacity-50 [&>option]:bg-[#0b1626]";

function Stepper({
  label,
  value,
  min,
  max,
  onChange,
  disabled,
  suffix,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  disabled: boolean;
  suffix: string;
}) {
  const button =
    "grid h-7 w-7 place-items-center rounded-md text-ink-2 transition-colors hover:bg-white/10 hover:text-ink-1 disabled:opacity-30 disabled:hover:bg-transparent";
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">{label}</span>
      <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-1 py-0.5">
        <button type="button" className={button} aria-label={`Decrease ${label}`} disabled={disabled || value <= min} onClick={() => onChange(value - 1)}>
          −
        </button>
        <span className="tabular min-w-[78px] text-center text-[13px] text-ink-1" aria-live="polite">
          {value} {suffix}
          {value === 1 ? "" : "s"}
        </span>
        <button type="button" className={button} aria-label={`Increase ${label}`} disabled={disabled || value >= max} onClick={() => onChange(value + 1)}>
          +
        </button>
      </div>
    </div>
  );
}

/**
 * Scenario settings shared by every analysis view: one row above the content it scopes.
 * Changing a setting recomputes all models with the live engine (latest change wins).
 */
export function ScenarioControls({ showModels = true }: { showModels?: boolean }) {
  const config = useApp((s) => s.config);
  const revealed = useApp((s) => s.revealed);
  const setConfig = useApp((s) => s.setConfig);
  const visible = useApp((s) => s.visibleModels);
  const toggleModel = useApp((s) => s.toggleModel);
  const focus = useApp((s) => s.focusModel);
  const setFocus = useApp((s) => s.setFocusModel);
  const computing = useApp((s) => s.computing);
  const runMs = useApp((s) => s.runMs);
  const runError = useApp((s) => s.runError);
  const canCompute = useCanCompute();
  const disabled = !canCompute;
  const maxTest = Math.min(MAX_STEP, revealed - MIN_TRAIN_MONTHS);
  const order = config.arima_order;

  const setOrder = (part: 0 | 1 | 2, value: number) => {
    const next: [number, number, number] = order ? [...order] : [1, 1, 0];
    next[part] = value;
    setConfig({ arima_order: next });
  };

  return (
    <div className="glass glass-strong flex flex-col gap-3 px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">Market level</span>
          <select
            className={selectClass}
            value={config.level}
            disabled={disabled}
            onChange={(e) => setConfig({ level: e.target.value as Level })}
          >
            {levelOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <Stepper
          label="Test window"
          value={config.test_size}
          min={1}
          max={maxTest}
          suffix="month"
          disabled={disabled}
          onChange={(v) => setConfig({ test_size: v })}
        />
        <Stepper
          label="Forecast horizon"
          value={config.horizon}
          min={1}
          max={MAX_STEP}
          suffix="month"
          disabled={disabled}
          onChange={(v) => setConfig({ horizon: v })}
        />
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">ARIMA order (p, d, q)</span>
          <div className="flex items-center gap-1.5">
            <select
              className={selectClass}
              value={order ? "manual" : "auto"}
              disabled={disabled}
              onChange={(e) => setConfig({ arima_order: e.target.value === "auto" ? null : [1, 1, 0] })}
              aria-label="ARIMA order selection"
            >
              <option value="auto">Auto (lowest AICc)</option>
              <option value="manual">Manual</option>
            </select>
            {order &&
              ([0, 1, 2] as const).map((part) => (
                <select
                  key={part}
                  className={selectClass}
                  value={order[part]}
                  disabled={disabled}
                  aria-label={["AR order p", "Differencing d", "MA order q"][part]}
                  onChange={(e) => setOrder(part, Number(e.target.value))}
                >
                  {(part === 1 ? [0, 1] : [0, 1, 2]).map((v) => (
                    <option key={v} value={v}>{["p", "d", "q"][part]} = {v}</option>
                  ))}
                </select>
              ))}
          </div>
        </div>
        <div className="ml-auto flex min-h-[30px] items-center gap-2 text-[12.5px] text-ink-3" aria-live="polite">
          {disabled ? (
            <span>Settings unlock when the live engine is ready.</span>
          ) : computing ? (
            <span className="flex items-center gap-2 text-accent"><Spinner /> Recomputing all models…</span>
          ) : runError ? (
            <span className="text-[#ff8a8a]">{runError}</span>
          ) : (
            <span>Computed in {fmtDuration(runMs)} by the live engine</span>
          )}
        </div>
      </div>
      {showModels && (
        <div className="flex flex-wrap items-center gap-2 border-t hairline pt-3">
          <span className="mr-1 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">Models</span>
          {MODEL_KEYS.map((key: ModelKey) => (
            <button
              key={key}
              type="button"
              aria-pressed={visible[key]}
              onClick={() => toggleModel(key)}
              className={`flex items-center gap-2 rounded-full border px-3 py-1 text-[12.5px] transition-colors ${
                visible[key] ? "border-white/15 bg-white/8 text-ink-1" : "border-white/5 bg-transparent text-ink-3 line-through decoration-ink-3/60"
              }`}
            >
              <span className="h-[3px] w-3.5 rounded-full" style={{ background: MODEL_META[key].hex, opacity: visible[key] ? 1 : 0.35 }} />
              {MODEL_META[key].label}
            </button>
          ))}
          <label className="ml-auto flex items-center gap-2 text-[12.5px] text-ink-2">
            Range shown for
            <select className={selectClass} value={focus} onChange={(e) => setFocus(e.target.value as ModelKey)}>
              {(["arima", "naive", "snaive", "rf"] as const).map((k) => (
                <option key={k} value={k}>{MODEL_META[k].label}</option>
              ))}
            </select>
          </label>
        </div>
      )}
    </div>
  );
}
