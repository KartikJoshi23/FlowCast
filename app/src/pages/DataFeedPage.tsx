import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { FeedControls } from "../components/FeedControls";
import { PageHeader } from "../components/PageHeader";
import { GlassPanel, StatusPill } from "../components/ui";
import { MAX_UNITS, parseMonthlyCsv, toMonthlyCsv, type CsvResult } from "../data/csv";
import { nextMonth, splitTotal } from "../data/panel";
import { CHANNELS, REGIONS, SERIES_KEYS } from "../data/types";
import { fmtMonth, fmtMonthShort, fmtUnits } from "../lib/format";
import { useApp, useCanCompute, useWorkingPanel } from "../state/store";

const th = "px-2 py-2 text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3";
const input =
  "w-full rounded-md border border-white/12 bg-white/5 px-2 py-1 text-right text-[13px] text-ink-1 outline-none focus:border-accent/60 tabular";

const validUnits = (v: string) => /^\d+$/.test(v.trim()) && Number(v) <= MAX_UNITS;

function AddMonthForm() {
  const working = useWorkingPanel();
  const addMonth = useApp((s) => s.addMonth);
  const canCompute = useCanCompute();
  const computing = useApp((s) => s.computing);
  const [mode, setMode] = useState<"total" | "series">("total");
  const [totalText, setTotalText] = useState("");
  const [cells, setCells] = useState<Record<string, string>>({});
  if (!working) return null;
  const month = nextMonth(working.months[working.months.length - 1]);
  const preview = mode === "total" && validUnits(totalText) ? splitTotal(Number(totalText), working) : null;
  const seriesValid = SERIES_KEYS.every((k) => validUnits(cells[k] ?? ""));
  const ready = mode === "total" ? Boolean(preview) : seriesValid;

  const submit = async () => {
    if (!ready) return;
    const series = mode === "total" ? preview! : Object.fromEntries(SERIES_KEYS.map((k) => [k, Number(cells[k])]));
    await addMonth(series, mode === "total" ? "total split by the latest 3-month mix" : "entered per region and channel");
    setTotalText("");
    setCells({});
  };

  return (
    <GlassPanel title={`Add ${fmtMonth(month)} by hand`} subtitle="Enter the next month's actual sales yourself instead of waiting for the feed. Every model retrains on it.">
      <div className="mb-3 flex gap-1.5" role="radiogroup" aria-label="Entry mode">
        {(["total", "series"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            onClick={() => setMode(m)}
            className={`rounded-full border px-3 py-1 text-[12.5px] ${mode === m ? "border-accent/40 bg-accent/12 text-ink-1" : "border-white/10 text-ink-3 hover:text-ink-2"}`}
          >
            {m === "total" ? "Total units" : "Per region × channel"}
          </button>
        ))}
      </div>
      {mode === "total" ? (
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-[12px] text-ink-3">
            Total units for {fmtMonth(month)}
            <input className={`${input} w-40`} inputMode="numeric" value={totalText} placeholder="e.g. 4600" onChange={(e) => setTotalText(e.target.value)} />
          </label>
          {totalText && !validUnits(totalText) && <span className="text-[12px] text-warning">Whole number between 0 and {fmtUnits(MAX_UNITS)}.</span>}
          {preview && <span className="text-[12px] text-ink-3">Split across the 9 series by their share of the last 3 months.</span>}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-[420px] text-[12.5px]">
            <thead>
              <tr>
                <th className={`${th} text-left`}>Region</th>
                {CHANNELS.map((c) => <th key={c} className={th}>{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {REGIONS.map((r) => (
                <tr key={r}>
                  <td className="px-2 py-1 text-ink-2">{r}</td>
                  {CHANNELS.map((c) => {
                    const key = `${r}|${c}`;
                    return (
                      <td key={c} className="px-2 py-1">
                        <input
                          className={`${input} w-24 ${cells[key] && !validUnits(cells[key]) ? "border-warning/60" : ""}`}
                          inputMode="numeric"
                          aria-label={`${r} ${c} units`}
                          value={cells[key] ?? ""}
                          onChange={(e) => setCells({ ...cells, [key]: e.target.value })}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <button
        type="button"
        disabled={!ready || !canCompute || computing}
        onClick={() => void submit()}
        className="mt-4 rounded-lg border border-accent/40 bg-accent/12 px-4 py-2 text-[13px] font-medium text-accent transition-colors hover:bg-accent/20 disabled:opacity-40"
      >
        Add {fmtMonthShort(month)} and recompute
      </button>
    </GlassPanel>
  );
}

function CsvPanel() {
  const working = useWorkingPanel();
  const importMonths = useApp((s) => s.importMonths);
  const canCompute = useCanCompute();
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<{ name: string; result: CsvResult } | null>(null);
  if (!working) return null;

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 512 * 1024) {
      setParsed({ name: file.name, result: { months: [], errors: ["File larger than 512 KB."] } });
      return;
    }
    setParsed({ name: file.name, result: parseMonthlyCsv(await file.text(), working) });
    e.target.value = "";
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([toMonthlyCsv(working)], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `flowcast-data-through-${working.months[working.months.length - 1]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const edits = parsed?.result.months.filter((m) => m.action === "edit").length ?? 0;
  const adds = parsed?.result.months.filter((m) => m.action === "add").length ?? 0;

  return (
    <GlassPanel title="Upload or download data" subtitle="CSV with a header row: month,region,channel,units (9 rows per month) or month,total.">
      <div className="flex flex-wrap gap-2">
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => void onFile(e)} />
        <button type="button" disabled={!canCompute} onClick={() => fileRef.current?.click()} className="rounded-lg border border-white/15 bg-white/5 px-3.5 py-2 text-[13px] text-ink-1 hover:bg-white/10 disabled:opacity-40">
          Choose CSV…
        </button>
        <button type="button" onClick={download} className="rounded-lg border border-white/10 px-3.5 py-2 text-[13px] text-ink-2 hover:bg-white/5 hover:text-ink-1">
          Download current data (CSV)
        </button>
      </div>
      {parsed && (
        <div className="mt-4 rounded-xl border border-white/8 bg-white/[0.03] p-4 text-[13px]">
          <p className="text-ink-1"><strong>{parsed.name}</strong>: {edits} month(s) to edit, {adds} to add.</p>
          {parsed.result.errors.length > 0 && (
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[12.5px] text-warning">
              {parsed.result.errors.slice(0, 8).map((e, i) => <li key={i}>{e}</li>)}
              {parsed.result.errors.length > 8 && <li>…and {parsed.result.errors.length - 8} more</li>}
            </ul>
          )}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={!parsed.result.months.length || !canCompute}
              onClick={() => {
                void importMonths(parsed.result.months, parsed.name);
                setParsed(null);
              }}
              className="rounded-lg border border-accent/40 bg-accent/12 px-3.5 py-1.5 text-[13px] text-accent hover:bg-accent/20 disabled:opacity-40"
            >
              Apply {parsed.result.months.length} month(s)
            </button>
            <button type="button" onClick={() => setParsed(null)} className="rounded-lg px-3 py-1.5 text-[13px] text-ink-3 hover:text-ink-1">Cancel</button>
          </div>
        </div>
      )}
    </GlassPanel>
  );
}

function EditableCell({ month, seriesKey, value }: { month: string; seriesKey: string; value: number }) {
  const editValue = useApp((s) => s.editValue);
  const canCompute = useCanCompute();
  const [text, setText] = useState<string | null>(null);
  const commit = () => {
    if (text !== null && validUnits(text) && Number(text) !== value) void editValue(month, seriesKey, Number(text));
    setText(null);
  };
  if (text !== null) {
    return (
      <input
        autoFocus
        className={`${input} w-20 ${validUnits(text) ? "" : "border-warning/60"}`}
        value={text}
        inputMode="numeric"
        aria-label={`${month} ${seriesKey} units`}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setText(null);
        }}
      />
    );
  }
  return (
    <button
      type="button"
      disabled={!canCompute}
      onClick={() => setText(String(value))}
      className="w-full rounded px-1 text-right tabular text-ink-1 transition-colors hover:bg-white/8 disabled:hover:bg-transparent"
      title="Click to edit (what-if)"
    >
      {fmtUnits(value)}
    </button>
  );
}

/** Data & Live Feed: the "real-time data" controls and the monthly data itself. */
export function DataFeedPage() {
  const panel = useApp((s) => s.panel);
  const revealed = useApp((s) => s.revealed);
  const changeLog = useApp((s) => s.changeLog);
  const analysis = useApp((s) => s.analysis);
  const working = useWorkingPanel();
  const rows = useMemo(() => {
    if (!working) return [];
    return working.months.map((month, i) => {
      const values = SERIES_KEYS.map((k) => working.series[k][i]);
      const source = working.user_added?.includes(month)
        ? "entered"
        : working.user_modified?.includes(month)
          ? "edited"
          : i >= (panel?.first_year_months ?? 12)
            ? "feed"
            : "first year";
      return { month, values, total: values.reduce((a, b) => a + b, 0), source };
    }).reverse();
  }, [working, panel]);
  if (!panel || !working) return null;
  const heldBack = panel.months.slice(revealed);
  const ops = analysis?.result.operations;

  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      <PageHeader title="Data & Live Feed">
        The slide's <strong className="text-ink-1">real-time data</strong>. The company starts with the first year. Every later month
        arrives when its sales close: click <em>Close month</em> or play the feed, enter a month yourself, edit any value for a what-if,
        or upload a CSV. After every change all five models retrain, the metrics and forecasts update, earlier forecasts are scored
        against the new actuals, and the AI interpretation is regenerated from the new facts.
      </PageHeader>

      <GlassPanel title="Live monthly feed">
        <FeedControls />
      </GlassPanel>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 sm:gap-5">
        <AddMonthForm />
        <CsvPanel />
      </div>

      <GlassPanel
        title="Monthly units by region and channel"
        subtitle="Newest first. Click a value to edit it. Held-back months stay hidden until they arrive."
        action={
          ops?.stockout_rows_last3 != null ? (
            <StatusPill tone="neutral" title={ops.method}>
              Last 3 months: {fmtUnits(ops.stockout_rows_last3)} stockout store-days ≈ {fmtUnits(ops.est_lost_units_last3)} units lost
            </StatusPill>
          ) : undefined
        }
      >
        <div className="max-h-[560px] overflow-auto">
          <table className="w-full min-w-[980px] text-[12.5px]">
            <thead className="sticky top-0 z-10 bg-[#0d1b2d]">
              <tr className="border-b hairline">
                <th className={`${th} text-left`} rowSpan={2}>Month</th>
                {REGIONS.map((r) => <th key={r} className={`${th} border-l hairline`} colSpan={3}>{r}</th>)}
                <th className={`${th} border-l hairline text-right`} rowSpan={2}>Total</th>
                <th className={`${th} text-left`} rowSpan={2}>Source</th>
              </tr>
              <tr className="border-b hairline">
                {REGIONS.flatMap((r) => CHANNELS.map((c, j) => (
                  <th key={`${r}${c}`} className={`${th} text-right ${j === 0 ? "border-l hairline" : ""}`}>{c}</th>
                )))}
              </tr>
            </thead>
            <tbody>
              {heldBack.length > 0 && (
                <tr className="border-b hairline">
                  <td colSpan={12} className="px-2 py-2.5 text-center text-[12px] text-ink-3">
                    {heldBack.length} held-back month{heldBack.length === 1 ? "" : "s"} ({fmtMonthShort(heldBack[0])} – {fmtMonthShort(heldBack[heldBack.length - 1])}) arrive through the feed
                  </td>
                </tr>
              )}
              {rows.map((row) => (
                <tr key={row.month} className="border-b hairline last:border-0">
                  <td className="whitespace-nowrap px-2 py-1.5 text-ink-2">{fmtMonth(row.month)}</td>
                  {row.values.map((v, j) => (
                    <td key={j} className={`px-1 py-1 text-right ${j % 3 === 0 ? "border-l hairline" : ""}`}>
                      <EditableCell month={row.month} seriesKey={SERIES_KEYS[j]} value={v} />
                    </td>
                  ))}
                  <td className="border-l hairline px-2 py-1.5 text-right font-semibold tabular text-ink-1">{fmtUnits(row.total)}</td>
                  <td className="px-2 py-1.5">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] ${
                      row.source === "feed" ? "bg-accent/12 text-accent" : row.source === "first year" ? "bg-white/6 text-ink-3" : "bg-warning/12 text-warning"
                    }`}>
                      {row.source}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </GlassPanel>

      <GlassPanel title="Change log" subtitle="Everything that changed the data in this session.">
        {changeLog.length === 0 ? (
          <p className="text-[13px] text-ink-3">No changes yet: the data is the first year exactly as given.</p>
        ) : (
          <ul className="space-y-1.5 text-[13px]">
            {changeLog.map((entry, i) => (
              <li key={i} className="flex gap-3">
                <span className="tabular shrink-0 text-ink-3">{new Date(entry.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                <span className="text-ink-2">{entry.text}</span>
              </li>
            ))}
          </ul>
        )}
      </GlassPanel>
    </div>
  );
}
