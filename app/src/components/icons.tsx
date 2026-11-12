import type { SVGProps } from "react";

/** Small inline icon set (stroke icons, 20px grid) - no icon library needed. */
type IconProps = SVGProps<SVGSVGElement> & { size?: number };

const base = (size: number, props: SVGProps<SVGSVGElement>) => ({
  width: size,
  height: size,
  viewBox: "0 0 20 20",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  ...props,
});

export const IconDrop = ({ size = 20, ...p }: IconProps) => (
  <svg {...base(size, p)}><path d="M10 2.5c3.2 4.2 5.5 7 5.5 9.9a5.5 5.5 0 0 1-11 0c0-2.9 2.3-5.7 5.5-9.9z" /></svg>
);
export const IconGauge = ({ size = 20, ...p }: IconProps) => (
  <svg {...base(size, p)}><path d="M3.5 13.5a6.5 6.5 0 1 1 13 0" /><path d="M10 13.5l3.2-4" /><circle cx="10" cy="13.5" r="1" /></svg>
);
export const IconTrend = ({ size = 20, ...p }: IconProps) => (
  <svg {...base(size, p)}><path d="M3 14l4-4 3 3 7-7" /><path d="M13 6h4v4" /></svg>
);
export const IconBars = ({ size = 20, ...p }: IconProps) => (
  <svg {...base(size, p)}><path d="M4 16V9M10 16V4M16 16v-5" /></svg>
);
export const IconWave = ({ size = 20, ...p }: IconProps) => (
  <svg {...base(size, p)}><path d="M2.5 10c2-3 3.5-3 5 0s3 3 5 0 3.5-3 5 0" /><path d="M2.5 14.5c2-3 3.5-3 5 0s3 3 5 0 3.5-3 5 0" opacity=".5" /></svg>
);
export const IconLayers = ({ size = 20, ...p }: IconProps) => (
  <svg {...base(size, p)}><path d="M10 3l7 4-7 4-7-4 7-4z" /><path d="M3 11l7 4 7-4" /></svg>
);
export const IconDatabase = ({ size = 20, ...p }: IconProps) => (
  <svg {...base(size, p)}><ellipse cx="10" cy="5" rx="6" ry="2.5" /><path d="M4 5v10c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V5" /><path d="M4 10c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5" /></svg>
);
export const IconSpark = ({ size = 20, ...p }: IconProps) => (
  <svg {...base(size, p)}><path d="M10 2.5l1.6 4.4 4.4 1.6-4.4 1.6L10 14.5l-1.6-4.4L4 8.5l4.4-1.6L10 2.5z" /><path d="M15.5 13.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8z" /></svg>
);
export const IconShield = ({ size = 20, ...p }: IconProps) => (
  <svg {...base(size, p)}><path d="M10 2.5l6 2.2v4.7c0 3.9-2.6 6.6-6 8.1-3.4-1.5-6-4.2-6-8.1V4.7l6-2.2z" /><path d="M7.3 10l1.9 1.9 3.6-3.8" /></svg>
);
export const IconCheck = ({ size = 16, ...p }: IconProps) => (
  <svg {...base(size, p)}><path d="M4.5 10.5l3.5 3.5 7.5-8" /></svg>
);
export const IconAlert = ({ size = 16, ...p }: IconProps) => (
  <svg {...base(size, p)}><path d="M10 3l7.5 13h-15L10 3z" /><path d="M10 8.5v3.5M10 14.4v.1" /></svg>
);
export const IconCross = ({ size = 16, ...p }: IconProps) => (
  <svg {...base(size, p)}><path d="M5.5 5.5l9 9M14.5 5.5l-9 9" /></svg>
);
export const IconClock = ({ size = 16, ...p }: IconProps) => (
  <svg {...base(size, p)}><circle cx="10" cy="10" r="7" /><path d="M10 6v4l2.5 2" /></svg>
);

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden className="animate-spin">
      <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeOpacity=".25" strokeWidth="2.2" fill="none" />
      <path d="M17.5 10A7.5 7.5 0 0 0 10 2.5" stroke="currentColor" strokeWidth="2.2" fill="none" strokeLinecap="round" />
    </svg>
  );
}
