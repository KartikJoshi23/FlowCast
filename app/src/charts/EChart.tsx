import { BarChart, LineChart, ScatterChart } from "echarts/charts";
import {
  AriaComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  MarkPointComponent,
  TooltipComponent,
} from "echarts/components";
import * as echarts from "echarts/core";
import type { EChartsCoreOption } from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";

echarts.use([
  LineChart, BarChart, ScatterChart, GridComponent, TooltipComponent, LegendComponent,
  MarkAreaComponent, MarkLineComponent, MarkPointComponent, AriaComponent, SVGRenderer,
]);

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Thin React wrapper around ECharts (SVG renderer: crisp at any zoom, small data).
 * Updates merge by series id so recomputed results animate from the previous state; while
 * a recompute is running the previous render is held at reduced opacity (no skeleton flash).
 */
export function EChart({
  option,
  height,
  label,
  dimmed = false,
}: {
  option: EChartsCoreOption;
  height: number;
  label: string;
  dimmed?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const instance = echarts.init(element, undefined, { renderer: "svg" });
    chart.current = instance;
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(element);
    return () => {
      observer.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    chart.current?.setOption(
      { animation: !prefersReducedMotion(), animationDurationUpdate: 450, ...option },
      { replaceMerge: ["series", "xAxis", "yAxis"] },
    );
  }, [option]);

  return (
    <div
      ref={container}
      role="img"
      aria-label={label}
      style={{ height }}
      className={`w-full transition-opacity duration-300 ${dimmed ? "opacity-45" : "opacity-100"}`}
    />
  );
}
