import { motion } from "motion/react";
import { fmtMonth } from "../lib/format";
import { useApp, useCanCompute, useWorkingPanel } from "../state/store";
import { Spinner } from "./icons";

const button =
  "inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40";

/**
 * Live monthly feed: each click (or each step while playing) closes the next month's sales,
 * the engine retrains every model, and the interpretation refreshes when the feed pauses.
 */
export function FeedControls({ compact = false }: { compact?: boolean }) {
  const panel = useApp((s) => s.panel);
  const revealed = useApp((s) => s.revealed);
  const playing = useApp((s) => s.feedPlaying);
  const computing = useApp((s) => s.computing);
  const revealNext = useApp((s) => s.revealNext);
  const play = useApp((s) => s.playFeed);
  const pause = useApp((s) => s.pauseFeed);
  const reset = useApp((s) => s.resetData);
  const canCompute = useCanCompute();
  const working = useWorkingPanel();
  if (!panel || !working) return null;

  const total = panel.months.length;
  const first = panel.first_year_months;
  const fed = revealed - first;
  const remaining = total - revealed;
  const nextMonth = remaining > 0 ? panel.months[revealed] : null;
  const dataThrough = working.months[working.months.length - 1];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={`${button} border-accent/40 bg-accent/12 text-accent hover:bg-accent/20`}
          disabled={!canCompute || playing || computing || remaining === 0}
          onClick={() => void revealNext()}
        >
          {computing && !playing ? <Spinner /> : <span aria-hidden>＋</span>}
          {nextMonth ? `Close ${fmtMonth(nextMonth)}` : "All months arrived"}
        </button>
        {playing ? (
          <button type="button" className={`${button} border-white/15 bg-white/8 text-ink-1 hover:bg-white/12`} onClick={pause}>
            <span aria-hidden>❚❚</span> Pause feed
          </button>
        ) : (
          <button
            type="button"
            className={`${button} border-white/15 bg-white/5 text-ink-1 hover:bg-white/10`}
            disabled={!canCompute || remaining === 0}
            onClick={play}
          >
            <span aria-hidden>▶</span> Play feed
          </button>
        )}
        <button
          type="button"
          className={`${button} border-white/10 text-ink-2 hover:bg-white/5 hover:text-ink-1`}
          disabled={!canCompute || (fed === 0 && working.months.length === first && !working.user_modified?.length)}
          onClick={() => void reset()}
        >
          Reset to first year
        </button>
      </div>
      <div>
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-ink-2">
          <span>
            Data through <strong className="text-ink-1">{fmtMonth(dataThrough)}</strong> · {working.months.length} months
            {fed > 0 && <> · {fed} arrived since the first year</>}
          </span>
          <span className="text-ink-3">{remaining > 0 ? `${remaining} held-back months left` : "feed complete"}</span>
        </div>
        <div className="relative h-2 overflow-hidden rounded-full bg-white/8" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={revealed} aria-label="Months of data available">
          <div className="absolute inset-y-0 left-0 bg-m-naive/50" style={{ width: `${(100 * first) / total}%` }} />
          <motion.div
            className="absolute inset-y-0 bg-gradient-to-r from-accent/70 to-accent"
            style={{ left: `${(100 * first) / total}%` }}
            animate={{ width: `${(100 * fed) / total}%` }}
            transition={{ duration: 0.5, ease: "easeOut" }}
          />
        </div>
        {!compact && (
          <div className="mt-1.5 flex justify-between text-[11.5px] text-ink-3">
            <span>First year (given)</span>
            <span>Live feed: Aug 2023 – Dec 2024</span>
          </div>
        )}
      </div>
      {playing && <p className="text-[12px] text-ink-3">Playing: one month every few seconds. The AI interpretation refreshes when you pause.</p>}
    </div>
  );
}
