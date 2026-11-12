import { useMemo } from "react";
import { EChart } from "../charts/EChart";
import { lifecycleOption, miniLineOption, yearOverYearOption } from "../charts/explore";
import { PageHeader } from "../components/PageHeader";
import { ScenarioControls } from "../components/ScenarioControls";
import { GlassPanel, StatTile } from "../components/ui";
import { CHANNELS, REGIONS, SERIES_KEYS } from "../data/types";
import { fmtPct, fmtUnits } from "../lib/format";
import { useApp, useWorkingPanel } from "../state/store";

const SEASONAL_MONTHS = 24;

/** Trend & Seasonality: lifecycle, year-over-year shape, identifiability, and market breakdowns (Task 7a). */
export function SeasonalityPage() {
  const analysis = useApp((s) => s.analysis);
  const panel = useApp((s) => s.panel);
  const computing = useApp((s) => s.computing);
  const working = useWorkingPanel();

  const lifecycle = useMemo(() => (analysis && panel ? lifecycleOption(analysis.result, panel.first_year_months) : null), [analysis, panel]);
  const yoy = useMemo(() => (analysis ? yearOverYearOption(analysis.result) : null), [analysis]);
  const multiples = useMemo(() => {
    if (!working) return null;
    const sum = (keys: string[]) => working.months.map((_, i) => keys.reduce((a, k) => a + working.series[k][i], 0));
    const regions = REGIONS.map((r) => ({ name: r, values: sum(SERIES_KEYS.filter((k) => k.startsWith(`${r}|`))) }));
    const channels = CHANNELS.map((c) => ({ name: c, values: sum(SERIES_KEYS.filter((k) => k.endsWith(`|${c}`))) }));
    const max = Math.max(...[...regions, ...channels].flatMap((s) => s.values)) * 1.1;
    const panels = [
      ...regions.map((r) => ({ ...r, kind: "Region" })),
      ...channels.map((c) => ({ ...c, kind: "Channel" })),
    ].map((m) => ({ ...m, option: miniLineOption(working.months, m.values, max) }));
    return { panels };
  }, [working]);
  if (!analysis || !lifecycle || !yoy || !multiples || !working) return null;

  const { result } = analysis;
  const s = result.seasonality;
  const t = result.trend;
  const months = s.months_of_data;

  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      <PageHeader title="Trend & Seasonality">
        Can the models see the product's <strong className="text-ink-1">trend</strong> (launch, growth, maturity) and its{" "}
        <strong className="text-ink-1">seasonality</strong> (summer peak, winter trough)? With one year of data every calendar month has been
        seen once, so seasonality cannot be told apart from the launch effect. It becomes learnable after two full cycles ({SEASONAL_MONTHS}{" "}
        months). Add months through the feed and watch that happen.
      </PageHeader>

      <ScenarioControls showModels={false} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4 sm:gap-4">
        <StatTile label="Last 3 vs previous 3 months" value={fmtPct(t.last3_vs_prev3_pct as number | null, true)} detail={`average ${fmtUnits(t.last3_avg_units as number)} units a month`} />
        <StatTile label="Summer vs winter" value={fmtPct(s.summer_vs_winter_pct, true)} detail={`Jun–Aug avg ${fmtUnits(s.summer_avg_units)} · Dec–Feb avg ${fmtUnits(s.winter_avg_units)}`} delay={0.04} />
        <StatTile label="Year over year (latest month)" value={t.yoy_latest_pct === null ? "n/a" : fmtPct(t.yoy_latest_pct as number, true)} detail={t.yoy_latest_pct === null ? "needs 13 months of data" : "same month, previous year"} delay={0.08} />
        <StatTile
          label="Seasonality identifiable"
          value={s.identifiable ? "Yes" : "Not yet"}
          detail={
            <div className="mt-1">
              <div className="h-1.5 overflow-hidden rounded-full bg-m-naive/20">
                <div className="h-full rounded-full bg-m-naive" style={{ width: `${Math.min(100, (100 * months) / SEASONAL_MONTHS)}%` }} />
              </div>
              <p className="mt-1.5">{months} of {SEASONAL_MONTHS} months · {s.calendar_months_seen_twice} calendar months seen twice</p>
            </div>
          }
          delay={0.12}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 sm:gap-5">
        <GlassPanel title={`Lifecycle: ${result.meta.level_label}`} subtitle="Every month available so far, with the end of the first year and the 24-month point marked.">
          <EChart option={lifecycle} height={300} dimmed={computing} label="Line chart of monthly units since launch." />
        </GlassPanel>
        <GlassPanel title="Same months, year over year" subtitle="Each line is one year. Lines that move together show seasonality that repeats." delay={0.05}>
          <EChart option={yoy} height={300} dimmed={computing} label="Line chart of monthly units by calendar month, one line per year." />
        </GlassPanel>
      </div>

      <GlassPanel title="Regions and channels" subtitle="Small multiples on one shared scale (all markets, all available months).">
        <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
          {multiples.panels.map((m) => (
            <div key={`${m.kind}${m.name}`}>
              <p className="text-[12.5px] text-ink-2">
                <span className="text-ink-3">{m.kind}</span> {m.name}{" "}
                <span className="tabular text-ink-3">· last month {fmtUnits(m.values[m.values.length - 1])}</span>
              </p>
              <EChart option={m.option} height={120} label={`${m.kind} ${m.name} monthly units.`} />
            </div>
          ))}
        </div>
      </GlassPanel>
    </div>
  );
}
