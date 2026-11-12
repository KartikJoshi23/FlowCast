import type { ReactNode } from "react";
import { IconBars, IconDatabase, IconGauge, IconLayers, IconShield, IconSpark, IconTrend, IconWave } from "../components/icons";

export interface RouteDef {
  id: string;
  label: string;
  icon: ReactNode;
  description: string;
}

/** Navigation order follows the slide's workflow: overview -> forecast -> metrics -> insight. */
export const ROUTES: RouteDef[] = [
  { id: "overview", label: "Command Center", icon: <IconGauge />, description: "Headline KPIs, forecast and live feed." },
  { id: "forecast", label: "Forecast Lab", icon: <IconTrend />, description: "Actual vs predicted, forecasts and uncertainty ranges." },
  { id: "scoreboard", label: "Model Scoreboard", icon: <IconBars />, description: "MAPE and WAPE compared, with the math shown." },
  { id: "seasonality", label: "Trend & Seasonality", icon: <IconWave />, description: "Lifecycle, year-over-year and identifiability." },
  { id: "features", label: "Feature Engineering", icon: <IconLayers />, description: "Lag features, seasonal indicators, importance." },
  { id: "data", label: "Data & Live Feed", icon: <IconDatabase />, description: "Monthly data, live feed, add or edit months." },
  { id: "insights", label: "AI Interpretation", icon: <IconSpark />, description: "LLM answers to the three slide questions." },
  { id: "verification", label: "Verification", icon: <IconShield />, description: "Engine status and notebook parity." },
];

export const HOME_ROUTE = "overview";
