import { useMemo } from "react";
import { EChart } from "../charts/EChart";
import { forecastChartOption } from "../charts/options";
import { FeedControls } from "../components/FeedControls";
import { IconGauge, IconSpark, IconTrend, IconWave, Spinner } from "../components/icons";
import { BasisLine, GroundingBadge, SourceBadge } from "../components/interpretation";
import { GlassPanel, ModelDot, StatTile } from "../components/ui";
import { MODEL_KEYS, type ModelKey } from "../data/types";
import { fmtMonth, fmtMonthShort, fmtPct, fmtUnits, levelPhrase } from "../lib/format";
import { MODEL_META } from "../lib/models";
import { useAutoInterpretation, useInterpretation } from "../llm/interpretationStore";
import { useApp } from "../state/store";

const SEASONAL_MONTHS = 24;

/** Command Center: the answer at a glance, the live feed, and the current interpretation. */
export function CommandCenterPage() {
  const analysis = useApp((s) => s.analysis);
  const computing = useApp((s) => s.computing);
  const feedPlaying = useApp((s) => s.feedPlaying);
  useAutoInterpretation(feedPlaying);
  const interp = useInterpretation();

  const best: ModelKey | null = analysis?.result.ranking[0]?.model ?? null;
  const bandModel: ModelKey = best && analysis?.result.models[best].forecast?.lo80 ? best : "arima";
  const option = useMemo(() => {
    if (!analysis || !best) return null;
    const visible = Object.fromEntries(MODEL_KEYS.map((k) => [k, analysis.result.best_models.includes(k) || k === bandModel])) as Record<ModelKey, boolean>;
    return forecastChartOption({ analysis, visible, focus: bandModel });
  }, [analysis, best, bandModel]);
  if (!analysis || !option || !best) return null;

  const { result } = analysis;
  const { meta, trend } = result;
  const bestModel = result.models[best];
  const tied = result.best_models.map((k) => MODEL_META[k].label).join(" = ");
  const fc = bestModel.forecast;
  const fcTotal = fc ? fc.point.reduce((a, b) => a + b, 0) : null;
  const months = meta.n_months;
  const tracking = result.tracking;

  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      <div className="px-1">
        <h2 className="text-[22px] font-semibold tracking-tight text-ink-1 sm:text-[26px]">Command Center</h2>
        <p className="mt-1.5 max-w-4xl text-[14px] leading-relaxed text-ink-2">
          Demand outlook for the new flavored water ({levelPhrase(meta.level)}): the latest sales, the most accurate model on the
          most recent {meta.n_test} months, its forecast for the next {meta.horizon} months, and what the AI makes of it. Close the next
          month or play the feed to see everything update.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4 sm:gap-4">
        <StatTile
          label={`Latest month · ${fmtMonthShort(String(trend.latest_month))}`}
          icon={<IconTrend size={15} />}
          value={fmtUnits(Number(trend.latest_units))}
          detail={<>units sold · {trend.mom_change_pct === null ? "first month" : `${fmtPct(Number(trend.mom_change_pct), true)} vs previous month`}</>}
        />
        <StatTile
          label="Most accurate model"
          icon={<IconGauge size={15} />}
          value={<span className="text-[22px]">{tied}</span>}
          detail={<>WAPE {fmtPct(bestModel.test?.metrics.wape.value)} · MAPE {fmtPct(bestModel.test?.metrics.mape.value)} on {fmtMonthShort(meta.test_months[0])}–{fmtMonthShort(meta.test_months[meta.test_months.length - 1])}</>}
          delay={0.04}
        />
        <StatTile
          label={`Forecast · next ${meta.horizon} months`}
          icon={<IconSpark size={15} />}
          value={fcTotal === null ? "n/a" : fmtUnits(fcTotal)}
          detail={fc ? <>units by {MODEL_META[best].label} · {fmtMonthShort(fc.months[0])}: {fmtUnits(fc.point[0])}{fc.lo80 && fc.hi80 ? ` (80%: ${fmtUnits(fc.lo80[0])}–${fmtUnits(fc.hi80[0])})` : ""}</> : bestModel.forecast_reason}
          delay={0.08}
        />
        <StatTile
          label="Seasonality learnable"
          icon={<IconWave size={15} />}
          value={<>{Math.min(months, SEASONAL_MONTHS)}<span className="text-[16px] text-ink-3"> / {SEASONAL_MONTHS} months</span></>}
          detail={
            <div className="mt-1">
              <div className="h-1.5 overflow-hidden rounded-full bg-m-naive/20">
                <div className="h-full rounded-full bg-m-naive" style={{ width: `${Math.min(100, (100 * months) / SEASONAL_MONTHS)}%` }} />
              </div>
              <p className="mt-1.5">{months >= SEASONAL_MONTHS ? "Two full cycles: seasonal models are active." : `${SEASONAL_MONTHS - months} more months until seasonal models switch on.`}</p>
            </div>
          }
          delay={0.12}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3 sm:gap-5">
        <GlassPanel
          className="xl:col-span-2"
          title={`Actual sales and the ${MODEL_META[best].label} forecast`}
          subtitle={`Test window ${fmtMonth(meta.test_months[0])} – ${fmtMonth(meta.test_months[meta.test_months.length - 1])} · shaded range: ${MODEL_META[bandModel].label} 80% / 95%.`}
        >
          <EChart option={option} height={330} dimmed={computing} label={`Monthly sales with the ${MODEL_META[best].label} forecast for the next ${meta.horizon} months.`} />
        </GlassPanel>
        <div className="flex flex-col gap-4 sm:gap-5">
          <GlassPanel title="Live monthly feed" delay={0.05}>
            <FeedControls compact />
          </GlassPanel>
          <GlassPanel
            title="AI interpretation"
            delay={0.1}
            action={<a href="#/insights" className="text-[12.5px] text-accent hover:underline">Open full view →</a>}
          >
            {interp.status === "loading" && !interp.interpretation ? (
              <p className="flex items-center gap-2 text-[13px] text-ink-2"><Spinner /> Interpreting the latest facts…</p>
            ) : interp.interpretation ? (
              <div className={`flex flex-col gap-2.5 transition-opacity ${interp.status === "loading" ? "opacity-50" : ""}`}>
                <div className="flex flex-wrap gap-1.5">
                  <SourceBadge source={interp.source} />
                  {interp.grounding && (
                    <GroundingBadge checked={interp.grounding.numbers_checked} unverified={interp.grounding.unverified_numbers} badKeys={interp.grounding.invalid_evidence_keys} />
                  )}
                </div>
                <p className="line-clamp-6 text-[13px] leading-relaxed text-ink-1">{interp.interpretation.best_model.answer}</p>
                <ul className="space-y-1 text-[12.5px] text-ink-2">
                  {interp.interpretation.recommendations.slice(0, 3).map((r, i) => (
                    <li key={i} className="flex gap-2"><span className="text-accent">→</span>{r.title}</li>
                  ))}
                </ul>
                <BasisLine basis={interp.basis} generatedAt={interp.generatedAt}>
                  {feedPlaying && <span> · refreshes when the feed pauses</span>}
                </BasisLine>
              </div>
            ) : (
              <p className="text-[13px] text-ink-3">The interpretation appears here once the facts are ready.</p>
            )}
          </GlassPanel>
        </div>
      </div>

      <GlassPanel
        title="Forecast tracking"
        subtitle={tracking ? "Forecasts the models made in earlier months, scored now that the actual sales have arrived." : "Close the next month to start scoring the forecasts made so far."}
      >
        {tracking && tracking.by_model.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-[13px]">
              <thead>
                <tr className="border-b hairline text-left text-[11.5px] uppercase tracking-[0.08em] text-ink-3">
                  <th className="py-2 pr-3 font-medium">Model</th>
                  <th className="py-2 pr-3 text-right font-medium">Forecasts scored</th>
                  <th className="py-2 pr-3 text-right font-medium">Tracked WAPE</th>
                  <th className="py-2 pr-3 text-right font-medium">Bias</th>
                  <th className="py-2 text-right font-medium">Actual inside 80% range</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {[...tracking.by_model].sort((a, b) => (a.wape_pct ?? 1e9) - (b.wape_pct ?? 1e9)).map((row) => (
                  <tr key={row.model} className="border-b hairline last:border-0">
                    <td className="py-2.5 pr-3"><span className="flex items-center gap-2 text-ink-1"><ModelDot color={MODEL_META[row.model].hex} />{row.label}</span></td>
                    <td className="py-2.5 pr-3 text-right text-ink-2">{row.n_points}</td>
                    <td className="py-2.5 pr-3 text-right font-semibold text-ink-1">{fmtPct(row.wape_pct)}</td>
                    <td className="py-2.5 pr-3 text-right text-ink-2">{fmtPct(row.bias_pct, true)}</td>
                    <td className="py-2.5 text-right text-ink-2">{row.coverage80_pct === null ? "no range" : fmtPct(row.coverage80_pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-[13px] text-ink-3">No forecast has reached its target month yet.</p>
        )}
      </GlassPanel>
    </div>
  );
}
