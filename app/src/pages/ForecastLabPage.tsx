import { useMemo } from "react";
import { EChart } from "../charts/EChart";
import { forecastChartOption } from "../charts/options";
import { PageHeader } from "../components/PageHeader";
import { ScenarioControls } from "../components/ScenarioControls";
import { GlassPanel, ModelDot, StatusPill } from "../components/ui";
import { CHANNELS, MODEL_KEYS, REGIONS } from "../data/types";
import { fmtMonth, fmtMonthShort, fmtPct, fmtUnits } from "../lib/format";
import { MODEL_META } from "../lib/models";
import { useApp } from "../state/store";

const th = "py-2 pr-3 text-[11.5px] font-medium uppercase tracking-[0.08em] text-ink-3";

/** Forecast Lab: actual vs predicted (Task 6), next-months forecasts with ranges (Task 4), allocation. */
export function ForecastLabPage() {
  const analysis = useApp((s) => s.analysis);
  const visible = useApp((s) => s.visibleModels);
  const focus = useApp((s) => s.focusModel);
  const computing = useApp((s) => s.computing);
  const option = useMemo(() => (analysis ? forecastChartOption({ analysis, visible, focus }) : null), [analysis, visible, focus]);
  if (!analysis || !option) return null;

  const { result } = analysis;
  const { meta } = result;
  const focusFc = result.models[focus].forecast;
  const testRange = `${fmtMonth(meta.test_months[0])} – ${fmtMonth(meta.test_months[meta.test_months.length - 1])}`;
  const dist = result.distribution;

  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      <PageHeader title="Forecast Lab">
        Each model is trained on the months before the <strong className="text-ink-1">test window</strong> and predicts those months
        without seeing them: <em>actual vs predicted</em>. It is then refit on all {meta.n_months} months and forecasts the next{" "}
        {meta.horizon} months, with an uncertainty range where the model provides one.
      </PageHeader>

      <ScenarioControls />

      <GlassPanel
        title={`${meta.level_label}: actual vs predicted, and the next ${meta.horizon} months`}
        subtitle={`Training ${fmtMonth(meta.train_months[0])} – ${fmtMonth(meta.train_months[meta.train_months.length - 1])} (${meta.n_train} months) · test ${testRange} · solid markers = test-window predictions, dashed = forecast.`}
      >
        <EChart
          option={option}
          height={380}
          dimmed={computing}
          label={`Line chart of actual monthly units for ${meta.level_label} with each model's test-window predictions and ${meta.horizon}-month forecasts.`}
        />
        <p className="mt-3 text-[12.5px] leading-relaxed text-ink-3">
          {focusFc?.lo80
            ? <>Shaded: {MODEL_META[focus].label}'s 80% (darker) and 95% (lighter) uncertainty ranges{focus === "rf" ? ", a heuristic spread of its trees rather than a calibrated interval" : ""}.</>
            : <>{MODEL_META[focus].label} has no uncertainty range for this scenario.</>}{" "}
          XGBoost provides point forecasts only. Hover the chart for exact values; the tables below list every number.
        </p>
      </GlassPanel>

      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2 sm:gap-5">
        <GlassPanel title={`Forecast for the next ${meta.horizon} months`} subtitle="Point forecast with the 80% range underneath, where available.">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-[13px]">
              <thead>
                <tr className="border-b hairline text-left">
                  <th className={th}>Model</th>
                  {meta.future_months.map((m) => (
                    <th key={m} className={`${th} text-right`}>{fmtMonthShort(m)}</th>
                  ))}
                  <th className={`${th} text-right`}>Total</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {MODEL_KEYS.map((key) => {
                  const m = result.models[key];
                  const fc = m.forecast;
                  return (
                    <tr key={key} className="border-b hairline last:border-0 align-top">
                      <td className="py-2.5 pr-3">
                        <span className="flex items-center gap-2 text-ink-1">
                          <ModelDot color={MODEL_META[key].hex} />
                          {MODEL_META[key].label}
                        </span>
                        {!m.evaluated && fc && <span className="mt-0.5 block text-[11.5px] text-ink-3">not evaluated on the test window</span>}
                      </td>
                      {fc ? (
                        <>
                          {fc.point.map((v, i) => (
                            <td key={i} className="py-2.5 pr-3 text-right">
                              <span className="text-ink-1">{fmtUnits(v)}</span>
                              {fc.lo80 && fc.hi80 && (
                                <span className="block text-[11.5px] text-ink-3">{fmtUnits(fc.lo80[i])}–{fmtUnits(fc.hi80[i])}</span>
                              )}
                            </td>
                          ))}
                          <td className="py-2.5 text-right font-semibold text-ink-1">{fmtUnits(fc.point.reduce((a, b) => a + b, 0))}</td>
                        </>
                      ) : (
                        <td colSpan={meta.horizon + 1} className="py-2.5 text-right text-ink-3">{m.forecast_reason}</td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </GlassPanel>

        <GlassPanel title="Test window: actual vs predicted" subtitle={`Units per month, ${testRange}. Predictions were made using the training months only.`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-[13px]">
              <thead>
                <tr className="border-b hairline text-left">
                  <th className={th}>Month</th>
                  <th className={`${th} text-right`}>Actual</th>
                  {MODEL_KEYS.filter((k) => result.models[k].evaluated).map((k) => (
                    <th key={k} className={`${th} text-right`}>
                      <span className="inline-flex items-center gap-1.5"><ModelDot color={MODEL_META[k].hex} />{MODEL_META[k].label}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="tabular">
                {meta.test_months.map((month, i) => (
                  <tr key={month} className="border-b hairline last:border-0">
                    <td className="py-2.5 pr-3 text-ink-2">{fmtMonth(month)}</td>
                    <td className="py-2.5 pr-3 text-right font-semibold text-ink-1">{fmtUnits(result.actual.units[meta.n_train + i])}</td>
                    {MODEL_KEYS.filter((k) => result.models[k].evaluated).map((k) => (
                      <td key={k} className="py-2.5 pr-3 text-right text-ink-1">{fmtUnits(result.models[k].test!.predicted[i])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {MODEL_KEYS.filter((k) => !result.models[k].evaluated).map((k) => (
            <p key={k} className="mt-3 text-[12.5px] text-ink-3">
              <span className="text-ink-2">{MODEL_META[k].label}:</span> {result.models[k].not_evaluated_reason}
            </p>
          ))}
        </GlassPanel>
      </div>

      {dist && (
        <GlassPanel
          title={`Distribution plan: next ${meta.horizon} months by region and channel`}
          subtitle={`Based on the best model on the test window (${dist.label}). ${dist.method}`}
          action={<StatusPill tone="neutral">Total {fmtUnits(dist.cells.reduce((a, c) => a + c.total, 0))} units</StatusPill>}
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-[13px]">
              <thead>
                <tr className="border-b hairline text-left">
                  <th className={th}>Region</th>
                  {CHANNELS.map((c) => (
                    <th key={c} className={`${th} text-right`}>{c}</th>
                  ))}
                  <th className={`${th} text-right`}>Region total</th>
                  <th className={`${th} text-right`}>Share</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {REGIONS.filter((r) => dist.cells.some((c) => c.region === r)).map((region) => {
                  const cells = dist.cells.filter((c) => c.region === region);
                  const regionTotal = cells.reduce((a, c) => a + c.total, 0);
                  const grand = dist.cells.reduce((a, c) => a + c.total, 0) || 1;
                  return (
                    <tr key={region} className="border-b hairline last:border-0">
                      <td className="py-2.5 pr-3 text-ink-2">{region}</td>
                      {CHANNELS.map((channel) => {
                        const cell = cells.find((c) => c.channel === channel);
                        return (
                          <td key={channel} className="py-2.5 pr-3 text-right text-ink-1">{cell ? fmtUnits(cell.total) : "–"}</td>
                        );
                      })}
                      <td className="py-2.5 pr-3 text-right font-semibold text-ink-1">{fmtUnits(regionTotal)}</td>
                      <td className="py-2.5 text-right text-ink-2">{fmtPct((100 * regionTotal) / grand)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </GlassPanel>
      )}
    </div>
  );
}
