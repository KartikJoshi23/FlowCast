import { motion } from "motion/react";
import { BasisLine, EvidenceList, GroundingBadge, HighlightedText, SourceBadge } from "../components/interpretation";
import { Spinner } from "../components/icons";
import { PageHeader } from "../components/PageHeader";
import { GlassPanel } from "../components/ui";
import { useAutoInterpretation, useInterpretation } from "../llm/interpretationStore";
import { useApp } from "../state/store";

const QUESTIONS = [
  { key: "seasonality_trend", number: 1, title: "How well did the models capture seasonality and trends?" },
  { key: "best_model", number: 2, title: "Which model performed best, and why?" },
] as const;

/** AI Interpretation: the slide's three questions, answered from the live facts (Task 7 + LLM requirement). */
export function InsightsPage() {
  const feedPlaying = useApp((s) => s.feedPlaying);
  useAutoInterpretation(feedPlaying);
  const analysis = useApp((s) => s.analysis);
  const { status, interpretation, grounding, source, generatedAt, basis, generate } = useInterpretation();
  if (!analysis) return null;

  const facts = analysis.facts;
  const unverified = grounding?.unverified_numbers ?? [];
  const loading = status === "loading";
  const stale = basis && basis.dataThrough !== analysis.result.meta.data_through;

  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      <PageHeader title="AI Interpretation">
        An LLM answers the slide's three questions from the <strong className="text-ink-1">facts</strong> the engine has just computed:
        the current metrics, forecasts, trend, seasonality and operations signals, rounded and nothing else. It may only quote
        those numbers. Each figure in the answer is checked against the facts, and if the LLM is unavailable a rule-based
        interpretation answers the same questions. When the data or settings change, the interpretation regenerates.
      </PageHeader>

      <div className="glass glass-strong flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            {loading ? (
              <span className="flex items-center gap-2 text-[13px] text-accent"><Spinner /> Generating interpretation from the latest facts…</span>
            ) : (
              <>
                <SourceBadge source={source} />
                {grounding && <GroundingBadge checked={grounding.numbers_checked} unverified={unverified} badKeys={grounding.invalid_evidence_keys} />}
              </>
            )}
          </div>
          <BasisLine basis={basis} generatedAt={generatedAt}>
            {stale && <span className="text-warning"> · data has changed; {feedPlaying ? "refreshes when the feed pauses" : "refreshing"}</span>}
          </BasisLine>
          {source?.kind === "rule-based" && !loading && (
            <p className="text-[12px] text-ink-3">LLM not used: {source.reason}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void generate(analysis, { force: true })}
          disabled={loading}
          className="rounded-lg border border-accent/35 bg-accent/10 px-3.5 py-2 text-[13px] font-medium text-accent transition-colors hover:bg-accent/18 disabled:opacity-40"
        >
          Regenerate
        </button>
      </div>

      {interpretation ? (
        <motion.div
          key={generatedAt ?? "none"}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: loading ? 0.5 : 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="grid grid-cols-1 gap-4 xl:grid-cols-2 sm:gap-5"
        >
          {QUESTIONS.map((q, i) => (
            <GlassPanel key={q.key} delay={i * 0.05} title={<><span className="mr-2 text-accent">{q.number}.</span>{q.title}</>}>
              <p className="text-[14px] leading-relaxed text-ink-1">
                <HighlightedText text={interpretation[q.key].answer} unverified={unverified} />
              </p>
              <EvidenceList keys={interpretation[q.key].evidence} facts={facts} />
            </GlassPanel>
          ))}

          <GlassPanel className="xl:col-span-2" delay={0.1} title={<><span className="mr-2 text-accent">3.</span>What should the company do?</>}>
            <ol className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {interpretation.recommendations.map((r, i) => (
                <li key={i} className="rounded-xl border border-white/8 bg-white/[0.03] p-4">
                  <p className="text-[13.5px] font-semibold text-ink-1">
                    <span className="mr-2 text-ink-3">{i + 1}</span>
                    <HighlightedText text={r.title} unverified={unverified} />
                  </p>
                  <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">
                    <HighlightedText text={r.detail} unverified={unverified} />
                  </p>
                  <EvidenceList keys={r.evidence} facts={facts} />
                </li>
              ))}
            </ol>
          </GlassPanel>

          <GlassPanel className="xl:col-span-2" delay={0.15} title="Caveats">
            <ul className="list-disc space-y-1.5 pl-5 text-[13.5px] leading-relaxed text-ink-2 marker:text-ink-3">
              {interpretation.caveats.map((c, i) => (
                <li key={i}><HighlightedText text={c} unverified={unverified} /></li>
              ))}
            </ul>
          </GlassPanel>
        </motion.div>
      ) : (
        <div className="flex items-center gap-3 px-2 py-10 text-ink-2"><Spinner size={18} /> Preparing the interpretation…</div>
      )}

      <GlassPanel title="Facts sent to the LLM" subtitle="Exactly what the model receives: computed by the engine from the current data and settings.">
        <details>
          <summary className="cursor-pointer text-[13px] text-accent">Show facts ({JSON.stringify(facts).length.toLocaleString("en-US")} characters)</summary>
          <pre className="mt-3 max-h-[420px] overflow-auto rounded-xl border border-white/8 bg-black/30 p-4 text-[11.5px] leading-relaxed text-ink-2">
            {JSON.stringify(facts, null, 2)}
          </pre>
        </details>
      </GlassPanel>
    </div>
  );
}
