import { fmtMonth } from "../lib/format";
import { useApp, useWorkingPanel } from "../state/store";
import { IconAlert, IconCheck, IconCross, Spinner } from "./icons";
import { StatusPill } from "./ui";

/** Engine state as a pill: loading -> verified / differs / unavailable. */
export function EngineBadge() {
  const engine = useApp((s) => s.engine);
  const parity = useApp((s) => s.parity);
  const computing = useApp((s) => s.computing);

  if (engine.phase === "failed") {
    return (
      <StatusPill tone="critical" icon={<IconCross size={14} />} title={engine.error ?? undefined}>
        Engine unavailable · showing notebook snapshot
      </StatusPill>
    );
  }
  if (engine.phase !== "ready") {
    return (
      <StatusPill tone="busy" icon={<Spinner />} title={engine.stage}>
        Live engine loading · {Math.round(engine.fraction * 100)}%
      </StatusPill>
    );
  }
  if (computing && parity.status === "pending") {
    return <StatusPill tone="busy" icon={<Spinner />}>Verifying against notebook</StatusPill>;
  }
  if (parity.status === "fail") {
    return <StatusPill tone="serious" icon={<IconAlert size={14} />}>Engine differs from notebook</StatusPill>;
  }
  if (parity.snapshotStale) {
    return <StatusPill tone="warning" icon={<IconAlert size={14} />}>Snapshot older than engine</StatusPill>;
  }
  return <StatusPill tone="good" icon={<IconCheck size={14} />}>Engine verified · matches notebook</StatusPill>;
}

export function StatusBar() {
  const working = useWorkingPanel();
  const source = useApp((s) => s.source);
  const dataThrough = working ? working.months[working.months.length - 1] : null;
  const months = working?.months.length ?? 0;

  return (
    <header className="glass glass-strong flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
      <div className="min-w-0">
        <p className="text-[11.5px] font-medium uppercase tracking-[0.1em] text-ink-3">New flavored water · SKU JU-021 proxy</p>
        <h1 className="truncate text-[17px] font-semibold tracking-tight text-ink-1">Monthly demand forecasting</h1>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {dataThrough && (
          <StatusPill tone="neutral">
            Data through {fmtMonth(dataThrough)} · {months} months
          </StatusPill>
        )}
        <StatusPill tone="neutral" title="Where the numbers on screen come from">
          Numbers: {source === "engine" ? "live engine" : "notebook snapshot"}
        </StatusPill>
        <EngineBadge />
      </div>
    </header>
  );
}
