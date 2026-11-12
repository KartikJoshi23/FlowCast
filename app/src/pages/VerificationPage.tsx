import { motion } from "motion/react";
import { IconAlert, IconCheck, IconClock, IconDatabase, IconShield, IconTrend, Spinner } from "../components/icons";
import { GlassPanel, ModelDot, StatTile, StatusPill } from "../components/ui";
import { CHANNELS, MODEL_KEYS, REGIONS } from "../data/types";
import { ARIMA_TOLERANCE, DEFAULT_TOLERANCE } from "../engine/parity";
import { fmtDeviation, fmtDuration, fmtMonth, fmtPct, fmtUnits } from "../lib/format";
import { MODEL_META } from "../lib/models";
import { useApp } from "../state/store";

/**
 * Verification view: proves the dashboard computes with the notebook's own code.
 * Shows the engine loading state, the parity check against the notebook snapshot,
 * library versions, and where the data comes from.
 */
export function VerificationPage() {
  const { panel, snapshot, engine, parity, analysis, source, runMs, runError } = useApp();
  if (!panel || !snapshot || !analysis) return null;

  const firstYear = panel.first_year_months;
  const heldBack = panel.months.length - firstYear;
  const firstYearUnits = analysis.result.actual.units.reduce((a, b) => a + b, 0);
  const live = source === "engine" ? analysis : null;
  const notebook = snapshot.default;
  const shaShort = (sha: string | null | undefined) => (sha ? `${sha.slice(0, 12)}…` : "n/a");

  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }} className="px-1">
        <h2 className="text-[22px] font-semibold tracking-tight text-ink-1 sm:text-[26px]">Engine & data verification</h2>
        <p className="mt-1.5 max-w-3xl text-[14px] leading-relaxed text-ink-2">
          Every forecast on this dashboard is computed in your browser by <strong className="text-ink-1">the notebook's own Python code</strong>,
          running on WebAssembly with the same library versions. Until that engine has loaded, the dashboard shows the notebook's saved
          results. Once it loads, it recomputes the first-year scenario and checks every number against those saved results.
        </p>
      </motion.div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4 sm:gap-4">
        <StatTile
          label="Months of data"
          icon={<IconDatabase size={15} />}
          value={<>{firstYear}<span className="text-[16px] text-ink-3"> of {panel.months.length}</span></>}
          detail={`First year ${fmtMonth(panel.months[0])} – ${fmtMonth(panel.months[firstYear - 1])}; ${heldBack} months held back for the live feed.`}
          delay={0.02}
        />
        <StatTile
          label="First-year sales"
          icon={<IconTrend size={15} />}
          value={fmtUnits(firstYearUnits)}
          detail="Units across 3 regions × 3 channels."
          delay={0.06}
        />
        <StatTile
          label="Engine load"
          icon={<IconClock size={15} />}
          value={engine.phase === "ready" ? fmtDuration(engine.info?.loadMs) : engine.phase === "failed" ? "Failed" : "Loading…"}
          detail={engine.phase === "ready" ? `Scenario computed in ${fmtDuration(runMs)}.` : engine.stage || "Preparing"}
          delay={0.1}
        />
        <StatTile
          label="Notebook parity"
          icon={<IconShield size={15} />}
          value={parity.status === "pass" ? "Verified" : parity.status === "fail" ? "Differs" : "Pending"}
          detail={
            parity.report
              ? `${parity.report.compared.toLocaleString("en-US")} numbers compared; max deviation ${fmtDeviation(parity.report.maxDeviation)}.`
              : "Runs once the engine is ready."
          }
          delay={0.14}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5 sm:gap-5">
        <GlassPanel
          className="xl:col-span-3"
          delay={0.08}
          title="Notebook parity: first-year scenario"
          subtitle={`Test window ${analysis.result.meta.test_months.map(fmtMonth).join(", ")}. Live engine vs the notebook's saved results.`}
          action={
            parity.status === "pass" ? (
              <StatusPill tone="good" icon={<IconCheck size={14} />}>All numbers match</StatusPill>
            ) : parity.status === "fail" ? (
              <StatusPill tone="serious" icon={<IconAlert size={14} />}>{parity.report?.mismatches.length} mismatches</StatusPill>
            ) : (
              <StatusPill tone="busy" icon={<Spinner />}>Waiting for engine</StatusPill>
            )
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-[13px]">
              <thead>
                <tr className="border-b hairline text-[11.5px] uppercase tracking-[0.08em] text-ink-3">
                  <th className="py-2 pr-3 font-medium">Model</th>
                  <th className="py-2 pr-3 text-right font-medium">WAPE notebook</th>
                  <th className="py-2 pr-3 text-right font-medium">WAPE live</th>
                  <th className="py-2 pr-3 text-right font-medium">MAPE live</th>
                  <th className="py-2 text-right font-medium">Forecast (next 3, live)</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {MODEL_KEYS.map((key) => {
                  const nb = notebook.result.models[key];
                  const lv = live?.result.models[key];
                  return (
                    <tr key={key} className="border-b hairline last:border-0">
                      <td className="py-2.5 pr-3">
                        <span className="flex items-center gap-2 text-ink-1">
                          <ModelDot color={MODEL_META[key].color} />
                          {MODEL_META[key].label}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 text-right text-ink-2">
                        {nb.evaluated ? fmtPct(nb.test?.metrics.wape.value) : <span className="text-ink-3">not evaluated</span>}
                      </td>
                      <td className="py-2.5 pr-3 text-right text-ink-1">
                        {!lv ? <span className="text-ink-3">…</span> : lv.evaluated ? fmtPct(lv.test?.metrics.wape.value) : <span className="text-ink-3">not evaluated</span>}
                      </td>
                      <td className="py-2.5 pr-3 text-right text-ink-2">
                        {lv?.evaluated ? fmtPct(lv.test?.metrics.mape.value) : "–"}
                      </td>
                      <td className="py-2.5 text-right text-ink-2">
                        {lv?.forecast ? lv.forecast.point.map((v) => fmtUnits(v)).join(" · ") : "–"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-[12.5px] leading-relaxed text-ink-3">
            Compared: the whole analysis (test predictions, metrics, forecasts, uncertainty ranges, facts and the rule-based interpretation).
            Tolerance {DEFAULT_TOLERANCE} relative (absolute below 1); ARIMA fields {ARIMA_TOLERANCE}, because its likelihood optimiser can stop a
            few millionths apart on WebAssembly.
            {parity.report && parity.report.worstPath && <> Largest deviation: <code className="text-ink-2">{parity.report.worstPath}</code>.</>}
          </p>
          {runError && <p className="mt-2 text-[13px] text-[#ff8a8a]">Engine error: {runError}</p>}
        </GlassPanel>

        <div className="flex flex-col gap-4 xl:col-span-2 sm:gap-5">
          <GlassPanel title="Live engine" delay={0.12} subtitle="Python 3.14 on WebAssembly (Pyodide), running in a background thread.">
            {engine.phase !== "ready" && engine.phase !== "failed" && (
              <div className="mb-4">
                <div className="mb-2 flex items-center justify-between text-[12.5px] text-ink-2">
                  <span className="truncate pr-3">{engine.stage || "Starting"}</span>
                  <span className="tabular text-ink-3">{Math.round(engine.fraction * 100)}%</span>
                </div>
                <div className="relative h-1.5 overflow-hidden rounded-full bg-white/8">
                  <motion.div
                    className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-m-naive to-accent"
                    animate={{ width: `${Math.max(4, engine.fraction * 100)}%` }}
                    transition={{ duration: 0.6, ease: "easeOut" }}
                  />
                  <div className="shimmer absolute inset-0" />
                </div>
                <p className="mt-2 text-[12px] text-ink-3">First visit downloads about 40 MB from jsDelivr; later visits load from the browser cache.</p>
              </div>
            )}
            {engine.phase === "failed" && (
              <p className="mb-3 text-[13px] text-[#ff8a8a]">The engine could not start ({engine.error}). The notebook snapshot remains available.</p>
            )}
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[13px]">
              <dt className="text-ink-3">Pyodide</dt>
              <dd className="tabular text-ink-1">{engine.info?.pyodideVersion ?? snapshot.pyodide_version}</dd>
              <dt className="text-ink-3">Engine version</dt>
              <dd className="tabular text-ink-1">{engine.info?.engineVersion ?? snapshot.engine_version}</dd>
              <dt className="text-ink-3">Engine fingerprint</dt>
              <dd className="tabular flex flex-wrap items-center gap-2 text-ink-1">
                <code>{shaShort(engine.info?.engineSha256 ?? snapshot.engine_sha256)}</code>
                {engine.info && (
                  parity.snapshotStale ? (
                    <StatusPill tone="warning" icon={<IconAlert size={13} />}>differs from snapshot</StatusPill>
                  ) : (
                    <StatusPill tone="good" icon={<IconCheck size={13} />}>same as snapshot</StatusPill>
                  )
                )}
              </dd>
              <dt className="text-ink-3">Snapshot created</dt>
              <dd className="tabular text-ink-1">{snapshot.created_utc.replace("T", " ").replace("Z", " UTC")}</dd>
            </dl>
          </GlassPanel>

          <GlassPanel title="Library versions" delay={0.16} subtitle="Notebook environment vs the browser engine.">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-[11.5px] uppercase tracking-[0.08em] text-ink-3">
                  <th className="pb-2 text-left font-medium">Library</th>
                  <th className="pb-2 text-right font-medium">Notebook</th>
                  <th className="pb-2 text-right font-medium">Browser</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {Object.entries(snapshot.libraries).map(([lib, version]) => {
                  const browser = engine.info?.libraries[lib];
                  const same = browser === version;
                  return (
                    <tr key={lib} className="border-t hairline">
                      <td className="py-1.5 text-ink-2">{lib}</td>
                      <td className="py-1.5 text-right text-ink-1">{version}</td>
                      <td className="py-1.5 text-right">
                        {browser ? (
                          <span className={`inline-flex items-center gap-1 ${same ? "text-[#7be07b]" : "text-warning"}`}>
                            {same ? <IconCheck size={13} /> : <IconAlert size={13} />}
                            {browser}
                          </span>
                        ) : (
                          <span className="text-ink-3">…</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </GlassPanel>
        </div>
      </div>

      <GlassPanel title="Data source" delay={0.2}>
        <div className="grid grid-cols-1 gap-4 text-[13px] leading-relaxed text-ink-2 md:grid-cols-2">
          <p>
            <strong className="text-ink-1">{panel.source?.dataset}</strong> by {panel.source?.author} ({panel.source?.license}).{" "}
            {panel.source?.note} The product is a stand-in for the new flavored water: SKU {panel.sku}, launched{" "}
            {panel.launch_date} in {REGIONS.length} regions and {CHANNELS.length} channels.
          </p>
          <p>
            Monthly panel: {fmtMonth(panel.months[0])} – {fmtMonth(panel.months[panel.months.length - 1])} ({panel.months.length} full months; the
            partial launch month is excluded). The first {firstYear} months are the "first year" on the slide. Months from{" "}
            {panel.held_back_from ? fmtMonth(panel.held_back_from) : "the 13th month"} onwards arrive through the live feed.{" "}
            <a className="text-accent underline-offset-2 hover:underline" href={panel.source?.url} target="_blank" rel="noreferrer">
              Dataset page
            </a>
          </p>
        </div>
      </GlassPanel>
    </div>
  );
}
