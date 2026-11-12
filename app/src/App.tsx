import { motion } from "motion/react";
import { lazy, Suspense, useEffect } from "react";
import { HOME_ROUTE, ROUTES } from "./app/routes";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Spinner } from "./components/icons";
import { NavRail } from "./components/NavRail";
import { StatusBar } from "./components/StatusBar";
import { GlassPanel } from "./components/ui";
import { useHashRoute } from "./lib/useHashRoute";
import { DataFeedPage } from "./pages/DataFeedPage";
import { VerificationPage } from "./pages/VerificationPage";
import { useApp } from "./state/store";

// Chart-heavy views are loaded on demand, so the charting library is not in the first download.
const CommandCenterPage = lazy(() => import("./pages/CommandCenterPage").then((m) => ({ default: m.CommandCenterPage })));
const ForecastLabPage = lazy(() => import("./pages/ForecastLabPage").then((m) => ({ default: m.ForecastLabPage })));
const ScoreboardPage = lazy(() => import("./pages/ScoreboardPage").then((m) => ({ default: m.ScoreboardPage })));
const SeasonalityPage = lazy(() => import("./pages/SeasonalityPage").then((m) => ({ default: m.SeasonalityPage })));
const FeaturesPage = lazy(() => import("./pages/FeaturesPage").then((m) => ({ default: m.FeaturesPage })));
const InsightsPage = lazy(() => import("./pages/InsightsPage").then((m) => ({ default: m.InsightsPage })));

function Page({ id }: { id: string }) {
  const route = ROUTES.find((r) => r.id === id) ?? ROUTES.find((r) => r.id === HOME_ROUTE)!;
  switch (route.id) {
    case "forecast":
      return <ForecastLabPage />;
    case "scoreboard":
      return <ScoreboardPage />;
    case "seasonality":
      return <SeasonalityPage />;
    case "features":
      return <FeaturesPage />;
    case "data":
      return <DataFeedPage />;
    case "insights":
      return <InsightsPage />;
    case "verification":
      return <VerificationPage />;
    default:
      return <CommandCenterPage />;
  }
}

function ViewLoading() {
  return (
    <div className="flex items-center gap-3 px-2 py-10 text-ink-2">
      <Spinner size={18} /> Loading view…
    </div>
  );
}

export default function App() {
  const boot = useApp((s) => s.boot);
  const ready = useApp((s) => Boolean(s.analysis));
  const loadError = useApp((s) => s.loadError);
  const route = useHashRoute();
  const active = route === "" ? HOME_ROUTE : route;

  useEffect(() => {
    void boot();
  }, [boot]);

  return (
    <>
      <div className="caustics" aria-hidden />
      <div className="relative z-10 mx-auto flex min-h-screen max-w-[1600px] flex-col gap-3 p-3 lg:flex-row lg:gap-4">
        <NavRail active={active} />
        <div className="flex min-w-0 flex-1 flex-col gap-3 sm:gap-4">
          <StatusBar />
          <main className="min-w-0 pb-8">
            {loadError ? (
              <GlassPanel title="Data could not be loaded">
                <p className="text-[13.5px] text-ink-2">{loadError}</p>
              </GlassPanel>
            ) : !ready ? (
              <ViewLoading />
            ) : (
              // Entrance-only transition: the new view mounts immediately (navigation never waits on an animation).
              <motion.div key={active} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}>
                <ErrorBoundary resetKey={active}>
                  <Suspense fallback={<ViewLoading />}>
                    <Page id={active} />
                  </Suspense>
                </ErrorBoundary>
              </motion.div>
            )}
          </main>
        </div>
      </div>
    </>
  );
}
