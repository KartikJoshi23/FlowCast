import { useMemo } from "react";
import { EChart } from "../charts/EChart";
import { acfOption, importanceOption, lagScatterOption } from "../charts/explore";
import { IconCheck } from "../components/icons";
import { PageHeader } from "../components/PageHeader";
import { ScenarioControls } from "../components/ScenarioControls";
import { GlassPanel, ModelDot } from "../components/ui";
import { fmtMonthShort, fmtUnits } from "../lib/format";
import { MODEL_META } from "../lib/models";
import { useApp } from "../state/store";

/** Every feature the ML models can use, with its meaning and availability rule. */
const FEATURES: { name: string; group: string; meaning: string; rule: string }[] = [
  { name: "lag_1", group: "Lag", meaning: "units one month earlier", rule: "always" },
  { name: "lag_2", group: "Lag", meaning: "units two months earlier", rule: "always" },
  { name: "lag_3", group: "Lag", meaning: "units three months earlier", rule: "≥ 12 training months" },
  { name: "rolling_mean_3", group: "Lag", meaning: "average of the previous 3 months", rule: "≥ 12 training months" },
  { name: "lag_12", group: "Seasonal", meaning: "units in the same month last year", rule: "≥ 24 training months" },
  { name: "month_sin", group: "Seasonal", meaning: "position in the year (sine of the 12-month cycle)", rule: "always" },
  { name: "month_cos", group: "Seasonal", meaning: "position in the year (cosine of the 12-month cycle)", rule: "always" },
  { name: "is_summer", group: "Seasonal", meaning: "1 for June–August", rule: "always" },
  { name: "months_since_launch", group: "Trend", meaning: "product age: launch ramp-up and lifecycle", rule: "always" },
  { name: "days_in_month", group: "Calendar", meaning: "28–31 days (February effect)", rule: "always" },
  { name: "region / channel", group: "Identity", meaning: "which of the 9 series (one-hot), for pooled training", rule: "always" },
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The seasonal indicators month_sin / month_cos place each month on a circle. */
function SeasonalRing() {
  const size = 200;
  const r = 72;
  const c = size / 2;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="mx-auto h-[200px] w-[200px]" role="img" aria-label="Months placed on a circle by their sine and cosine features.">
      <circle cx={c} cy={c} r={r} fill="none" stroke="rgba(150,200,255,.18)" />
      <line x1={c - r - 10} y1={c} x2={c + r + 10} y2={c} stroke="rgba(150,200,255,.12)" />
      <line x1={c} y1={c - r - 10} x2={c} y2={c + r + 10} stroke="rgba(150,200,255,.12)" />
      {MONTHS.map((m, i) => {
        const angle = (2 * Math.PI * (i + 1)) / 12;
        const x = c + r * Math.sin(angle);
        const y = c - r * Math.cos(angle);
        const summer = i >= 5 && i <= 7;
        return (
          <g key={m}>
            <circle cx={x} cy={y} r={5} fill={summer ? "#d95926" : "#3987e5"} stroke="#0b1626" strokeWidth={2} />
            <text x={c + (r + 18) * Math.sin(angle)} y={c - (r + 18) * Math.cos(angle) + 4} textAnchor="middle" fontSize={10.5} fill="#b4c3d6">{m}</text>
          </g>
        );
      })}
      <text x={c} y={c + 4} textAnchor="middle" fontSize={10} fill="#7f90a6">sin · cos</text>
    </svg>
  );
}

function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}

/** Feature Engineering (Task 1): lag features, seasonal indicators, and what the ML models used. */
export function FeaturesPage() {
  const analysis = useApp((s) => s.analysis);
  const computing = useApp((s) => s.computing);
  const derived = useMemo(() => {
    if (!analysis?.result.features) return null;
    const rows = analysis.result.features.rows;
    const points = rows.map((r) => ({ x: Number(r.lag_1), y: Number(r.target), label: `${String(r.series).replace("|", " · ")} · ${fmtMonthShort(String(r.month))}` }));
    return {
      points,
      corr: pearson(points.map((p) => p.x), points.map((p) => p.y)),
      scatter: lagScatterOption(points),
      acf: acfOption(analysis.result),
      rf: importanceOption(analysis.result.models.rf.info.importance ?? [], MODEL_META.rf.hex),
      xgb: importanceOption(analysis.result.models.xgb.info.importance ?? [], MODEL_META.xgb.hex),
    };
  }, [analysis]);
  if (!analysis || !derived) return null;

  const { meta, features } = analysis.result;
  const testCols = new Set(meta.feature_spec_test.columns);
  const fcCols = new Set(meta.feature_spec_forecast.columns);
  const used = (name: string, set: Set<string>) => (name === "region / channel" ? [...set].some((c) => c.startsWith("region=")) : set.has(name));
  const tableCols = features!.columns.filter((c) => !c.startsWith("region=") && !c.startsWith("channel="));
  const bound = analysis.result.diagnostics.acf_bound;

  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      <PageHeader title="Feature Engineering">
        To use Random Forest and XGBoost on a time series, each month becomes a row of <strong className="text-ink-1">features</strong>{" "}
        known before that month: <strong className="text-ink-1">lag features</strong> (recent sales) and{" "}
        <strong className="text-ink-1">seasonal indicators</strong> (position in the year). The 9 region × channel series are pooled, so the
        models learn from {features?.rows.length} rows instead of {meta.n_train}. Which features are allowed depends on how much history exists.
      </PageHeader>

      <ScenarioControls showModels={false} />

      <GlassPanel title="Features and when they switch on" subtitle={`Training window: ${meta.n_train} months · forecast refit: ${meta.n_months} months.`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-[13px]">
            <thead>
              <tr className="border-b hairline text-left text-[11.5px] uppercase tracking-[0.08em] text-ink-3">
                <th className="py-2 pr-3 font-medium">Feature</th>
                <th className="py-2 pr-3 font-medium">Type</th>
                <th className="py-2 pr-3 font-medium">Meaning</th>
                <th className="py-2 pr-3 font-medium">Available</th>
                <th className="py-2 pr-3 text-center font-medium">Test fit</th>
                <th className="py-2 text-center font-medium">Forecast fit</th>
              </tr>
            </thead>
            <tbody>
              {FEATURES.map((f) => (
                <tr key={f.name} className="border-b hairline last:border-0">
                  <td className="py-2 pr-3"><code className="text-ink-1">{f.name}</code></td>
                  <td className="py-2 pr-3 text-ink-3">{f.group}</td>
                  <td className="py-2 pr-3 text-ink-2">{f.meaning}</td>
                  <td className="py-2 pr-3 text-ink-3">{f.rule}</td>
                  {[testCols, fcCols].map((set, i) => (
                    <td key={i} className="py-2 pr-3 text-center">
                      {used(f.name, set) ? <IconCheck size={15} className="mx-auto text-[#7be07b]" /> : <span className="text-ink-3">–</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </GlassPanel>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3 sm:gap-5">
        <GlassPanel
          className="xl:col-span-2"
          title="Does last month predict this month? (series level)"
          subtitle={`Each dot is one region × channel series in one training month. Correlation ${derived.corr === null ? "n/a" : derived.corr.toFixed(2)}: close to 0 means individual series are noisy, so lags carry little signal.`}
        >
          <EChart option={derived.scatter} height={300} dimmed={computing} label="Scatter of units against the previous month's units." />
        </GlassPanel>
        <GlassPanel title="Seasonal indicators" subtitle="month_sin and month_cos put the 12 months on a circle, so December sits next to January. Summer is orange." delay={0.05}>
          <SeasonalRing />
        </GlassPanel>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3 sm:gap-5">
        <GlassPanel title="Autocorrelation of the selected level" subtitle={`Bars beyond ±${bound.toFixed(2)} are distinguishable from zero with ${meta.n_months} months.`}>
          <EChart option={derived.acf} height={240} dimmed={computing} label="Autocorrelation bar chart." />
        </GlassPanel>
        <GlassPanel title={<span className="flex items-center gap-2"><ModelDot color={MODEL_META.rf.hex} />Random Forest: what it used</span>} subtitle="Share of the model's split importance (forecast refit)." delay={0.04}>
          <EChart option={derived.rf} height={240} dimmed={computing} label="Random Forest feature importance." />
        </GlassPanel>
        <GlassPanel title={<span className="flex items-center gap-2"><ModelDot color={MODEL_META.xgb.hex} />XGBoost: what it used</span>} subtitle="Share of the model's gain (forecast refit)." delay={0.08}>
          <EChart option={derived.xgb} height={240} dimmed={computing} label="XGBoost feature importance." />
        </GlassPanel>
      </div>

      <GlassPanel title="The training table" subtitle={`${features?.rows.length} pooled rows (region and channel identifiers hidden). Every value uses only months before the row's month.`}>
        <div className="max-h-[380px] overflow-auto">
          <table className="w-full min-w-[860px] text-[12px]">
            <thead className="sticky top-0 bg-[#0d1b2d]">
              <tr className="border-b hairline text-left text-[11px] uppercase tracking-[0.06em] text-ink-3">
                <th className="px-2 py-2 font-medium">Series</th>
                <th className="px-2 py-2 font-medium">Month</th>
                {tableCols.map((c) => <th key={c} className="px-2 py-2 text-right font-medium">{c}</th>)}
                <th className="px-2 py-2 text-right font-medium">target</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {features!.rows.map((row, i) => (
                <tr key={i} className="border-b hairline last:border-0">
                  <td className="whitespace-nowrap px-2 py-1.5 text-ink-2">{String(row.series).replace("|", " · ")}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-ink-2">{fmtMonthShort(String(row.month))}</td>
                  {tableCols.map((c) => {
                    const v = Number(row[c]);
                    return <td key={c} className="px-2 py-1.5 text-right text-ink-1">{Math.abs(v) >= 10 ? fmtUnits(v) : v.toFixed(2)}</td>;
                  })}
                  <td className="px-2 py-1.5 text-right font-semibold text-ink-1">{fmtUnits(Number(row.target))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </GlassPanel>
    </div>
  );
}
