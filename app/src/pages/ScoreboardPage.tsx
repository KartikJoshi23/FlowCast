import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { EChart } from "../charts/EChart";
import { metricBarsOption } from "../charts/options";
import { IconAlert } from "../components/icons";
import { PageHeader } from "../components/PageHeader";
import { ScenarioControls } from "../components/ScenarioControls";
import { GlassPanel, ModelDot, StatusPill } from "../components/ui";
import { MODEL_KEYS, type ModelKey } from "../data/types";
import { fmtMonth, fmtPct, fmtUnits } from "../lib/format";
import { mathWorking, pct2 } from "../lib/math";
import { MODEL_META } from "../lib/models";
import { useApp } from "../state/store";

const th = "py-2 pr-3 text-[11.5px] font-medium uppercase tracking-[0.08em] text-ink-3";

function biasText(bias: number | null | undefined) {
  if (bias === null || bias === undefined) return "n/a";
  return `${fmtPct(bias, true)} ${bias < 0 ? "under" : bias > 0 ? "over" : ""}`.trim();
}

/** Model Scoreboard: MAPE & WAPE compared (Task 5), the ranking, and the worked formulas. */
export function ScoreboardPage() {
  const analysis = useApp((s) => s.analysis);
  const computing = useApp((s) => s.computing);
  const [picked, setPicked] = useState<ModelKey | null>(null);
  const mapeOption = useMemo(() => (analysis ? metricBarsOption(analysis, "mape") : null), [analysis]);
  const wapeOption = useMemo(() => (analysis ? metricBarsOption(analysis, "wape") : null), [analysis]);
  if (!analysis || !mapeOption || !wapeOption) return null;

  const { result } = analysis;
  const { meta, ranking } = result;
  const evaluated = MODEL_KEYS.filter((k) => result.models[k].evaluated);
  const mathKey: ModelKey = picked && result.models[picked].evaluated ? picked : (ranking[0]?.model ?? "naive");
  const mathModel = result.models[mathKey];
  const metrics = mathModel.test?.metrics;
  const work = metrics ? mathWorking(metrics.per_month) : null;
  const rankOf = new Map(ranking.map((r) => [r.model, r.rank]));
  const chartHeight = 44 + evaluated.length * 40;
  const testRange = `${fmtMonth(meta.test_months[0])} – ${fmtMonth(meta.test_months[meta.test_months.length - 1])}`;

  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      <PageHeader title="Model Scoreboard">
        Every model is scored on the same {meta.n_test}-month test window ({testRange}) with the same formulas.
        <strong className="text-ink-1"> WAPE</strong> (total error ÷ total volume) is the decision metric, because production is planned in
        units; <strong className="text-ink-1">MAPE</strong> (average % error per month) is shown alongside, as the slide asks.
      </PageHeader>

      <ScenarioControls showModels={false} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 sm:gap-5">
        <GlassPanel title="MAPE on the test window" subtitle="Mean of |A − F| ÷ A across months. Lower is better.">
          <EChart option={mapeOption} height={chartHeight} dimmed={computing} label="Bar chart of MAPE by model." />
        </GlassPanel>
        <GlassPanel title="WAPE on the test window" subtitle="Σ|A − F| ÷ Σ A. Volume-weighted. Lower is better." delay={0.05}>
          <EChart option={wapeOption} height={chartHeight} dimmed={computing} label="Bar chart of WAPE by model." />
        </GlassPanel>
      </div>

      <GlassPanel title="Ranking" subtitle="Models within 0.05 WAPE points share a rank. Skill = how much lower the WAPE is than Naive's.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-[13px]">
            <thead>
              <tr className="border-b hairline text-left">
                <th className={th}>Rank</th>
                <th className={th}>Model</th>
                <th className={`${th} text-right`}>WAPE</th>
                <th className={`${th} text-right`}>MAPE</th>
                <th className={`${th} text-right`}>Bias</th>
                <th className={`${th} text-right`}>Units mis-planned</th>
                <th className={`${th} text-right`}>Skill vs Naive</th>
                <th className={th}>Notes</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {[...evaluated.sort((a, b) => (rankOf.get(a) ?? 9) - (rankOf.get(b) ?? 9)), ...MODEL_KEYS.filter((k) => !result.models[k].evaluated)].map((key) => {
                const m = result.models[key];
                const t = m.test;
                const notes = [
                  key === "arima" ? (m.info.test_fit?.label ?? m.info.label) : null,
                  t?.identical_to.length ? `identical forecasts to ${t.identical_to.map((o) => MODEL_META[o].label).join(", ")}` : null,
                  t?.metrics.mape.n_excluded_zero ? `${t.metrics.mape.n_excluded_zero} zero-actual month(s) excluded from MAPE` : null,
                  t?.metrics.mape.near_zero_warning ? "near-zero actual inflates MAPE" : null,
                  !m.evaluated ? m.not_evaluated_reason : null,
                ].filter(Boolean);
                return (
                  <tr key={key} className="border-b hairline last:border-0">
                    <td className="py-2.5 pr-3">
                      {m.evaluated ? (
                        <span className={`grid h-6 w-6 place-items-center rounded-full text-[12px] font-semibold ${rankOf.get(key) === 1 ? "bg-accent/20 text-accent ring-1 ring-accent/40" : "bg-white/6 text-ink-2"}`}>
                          {rankOf.get(key)}
                        </span>
                      ) : (
                        <span className="text-ink-3">–</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3">
                      <span className="flex items-center gap-2 text-ink-1"><ModelDot color={MODEL_META[key].hex} />{MODEL_META[key].label}</span>
                    </td>
                    <td className="py-2.5 pr-3 text-right font-semibold text-ink-1">{t ? fmtPct(t.metrics.wape.value) : "–"}</td>
                    <td className="py-2.5 pr-3 text-right text-ink-1">{t ? fmtPct(t.metrics.mape.value) : "–"}</td>
                    <td className="py-2.5 pr-3 text-right text-ink-2">{t ? biasText(t.metrics.bias.value) : "–"}</td>
                    <td className="py-2.5 pr-3 text-right text-ink-2">{t ? fmtUnits(t.metrics.abs_error_units) : "–"}</td>
                    <td className="py-2.5 pr-3 text-right text-ink-2">
                      {key === "naive" || !t || t.skill_vs_naive_pct === null ? "–" : fmtPct(t.skill_vs_naive_pct, true)}
                    </td>
                    <td className="py-2.5 text-[12.5px] text-ink-3">{notes.join(" · ") || "–"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </GlassPanel>

      {metrics && work && (
        <GlassPanel
          title="Show the math"
          subtitle="The slide's metrics worked through with the live numbers. Pick a model."
          action={
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Model for the worked example">
              {evaluated.map((key) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={key === mathKey}
                  onClick={() => setPicked(key)}
                  className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition-colors ${
                    key === mathKey ? "border-accent/40 bg-accent/12 text-ink-1" : "border-white/10 text-ink-3 hover:text-ink-2"
                  }`}
                >
                  <ModelDot color={MODEL_META[key].hex} />
                  {MODEL_META[key].label}
                </button>
              ))}
            </div>
          }
        >
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[440px] text-[13px]">
                <thead>
                  <tr className="border-b hairline text-left">
                    <th className={th}>Month</th>
                    <th className={`${th} text-right`}>A (actual)</th>
                    <th className={`${th} text-right`}>F (forecast)</th>
                    <th className={`${th} text-right`}>|A − F|</th>
                    <th className={`${th} text-right`}>|A − F| ÷ A</th>
                  </tr>
                </thead>
                <tbody className="tabular">
                  {metrics.per_month.map((r) => (
                    <tr key={r.month} className="border-b hairline">
                      <td className="py-2 pr-3 text-ink-2">{fmtMonth(r.month)}</td>
                      <td className="py-2 pr-3 text-right text-ink-1">{fmtUnits(r.actual)}</td>
                      <td className="py-2 pr-3 text-right text-ink-1">{fmtUnits(r.forecast)}</td>
                      <td className="py-2 pr-3 text-right text-ink-1">{fmtUnits(r.abs_error)}</td>
                      <td className="py-2 text-right text-ink-1">{r.abs_pct_error === null ? "excluded (A = 0)" : pct2(r.abs_pct_error)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="pt-2.5 text-[12px] uppercase tracking-[0.08em] text-ink-3">Σ</td>
                    <td className="pt-2.5 pr-3 text-right font-semibold text-ink-1">{fmtUnits(work.sumAbsActual)}</td>
                    <td />
                    <td className="pt-2.5 pr-3 text-right font-semibold text-ink-1">{fmtUnits(work.sumAbsError)}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
            <motion.div key={mathKey} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.3 }} className="flex flex-col gap-3 text-[13.5px]">
              <div className="rounded-xl border border-white/8 bg-white/[0.03] p-4">
                <p className="text-[11.5px] font-medium uppercase tracking-[0.08em] text-ink-3">MAPE: mean absolute percentage error</p>
                <p className="tabular mt-2 leading-relaxed text-ink-2">
                  = (1 ÷ {work.nUsedForMape}) × ({work.apeTerms.map(pct2).join(" + ")})
                  <br />= <strong className="text-[16px] text-ink-1">{pct2(metrics.mape.value)}</strong>
                </p>
              </div>
              <div className="rounded-xl border border-white/8 bg-white/[0.03] p-4">
                <p className="text-[11.5px] font-medium uppercase tracking-[0.08em] text-ink-3">WAPE: weighted absolute percentage error</p>
                <p className="tabular mt-2 leading-relaxed text-ink-2">
                  = Σ|A − F| ÷ Σ A = {fmtUnits(work.sumAbsError)} ÷ {fmtUnits(work.sumAbsActual)}
                  <br />= <strong className="text-[16px] text-ink-1">{pct2(metrics.wape.value)}</strong>
                </p>
              </div>
              <div className="rounded-xl border border-white/8 bg-white/[0.03] p-4">
                <p className="text-[11.5px] font-medium uppercase tracking-[0.08em] text-ink-3">Bias and business impact</p>
                <p className="tabular mt-2 leading-relaxed text-ink-2">
                  Bias = Σ(F − A) ÷ Σ A = {fmtUnits(work.sumSignedError)} ÷ {fmtUnits(work.sumAbsActual)} ={" "}
                  <strong className="text-ink-1">{pct2(metrics.bias.value)}</strong>
                  <br />
                  Planning on {MODEL_META[mathKey].label} would have left <strong className="text-ink-1">{fmtUnits(work.shortfallUnits)} units short</strong>{" "}
                  (stockout risk) and <strong className="text-ink-1">{fmtUnits(work.surplusUnits)} units surplus</strong> (excess stock).
                </p>
              </div>
              {(metrics.mape.near_zero_warning || metrics.mape.n_excluded_zero > 0) && (
                <StatusPill tone="warning" icon={<IconAlert size={13} />}>
                  {metrics.mape.n_excluded_zero > 0
                    ? `${metrics.mape.n_excluded_zero} month(s) with zero actual excluded from MAPE`
                    : "A near-zero actual inflates MAPE; prefer WAPE"}
                </StatusPill>
              )}
            </motion.div>
          </div>
        </GlassPanel>
      )}
    </div>
  );
}
