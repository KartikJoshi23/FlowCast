import { motion } from "motion/react";
import type { ReactNode } from "react";

/** Frosted-glass card with optional title row. */
export function GlassPanel({
  title,
  subtitle,
  action,
  children,
  className = "",
  delay = 0,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <motion.section
      className={`glass p-5 sm:p-6 ${className}`}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1], delay }}
    >
      {(title || action) && (
        <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-[15px] font-semibold tracking-tight text-ink-1">{title}</h2>}
            {subtitle && <p className="mt-1 text-[13px] leading-relaxed text-ink-3">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </motion.section>
  );
}

/** Headline number (stat tile). Proportional figures, as recommended for hero numbers. */
export function StatTile({
  label,
  value,
  detail,
  icon,
  delay = 0,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  icon?: ReactNode;
  delay?: number;
}) {
  return (
    <motion.div
      className="glass flex min-w-0 flex-col gap-2 p-4 sm:p-5"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1], delay }}
    >
      <div className="flex items-center gap-2 text-[12px] font-medium uppercase tracking-[0.08em] text-ink-3">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="text-[26px] font-semibold leading-none tracking-tight text-ink-1">{value}</div>
      {detail && <div className="text-[12.5px] leading-snug text-ink-2">{detail}</div>}
    </motion.div>
  );
}

export type StatusTone = "good" | "warning" | "serious" | "critical" | "neutral" | "busy";

const toneClass: Record<StatusTone, string> = {
  good: "border-good/40 bg-good/12 text-[#7be07b]",
  warning: "border-warning/40 bg-warning/10 text-warning",
  serious: "border-serious/40 bg-serious/10 text-serious",
  critical: "border-critical/45 bg-critical/12 text-[#ff8a8a]",
  neutral: "border-white/10 bg-white/5 text-ink-2",
  busy: "border-accent/30 bg-accent/10 text-accent",
};

/** Pill with icon + label (status colour never carries meaning alone). */
export function StatusPill({ tone, icon, children, title }: { tone: StatusTone; icon?: ReactNode; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium whitespace-nowrap ${toneClass[tone]}`}
    >
      {icon}
      {children}
    </span>
  );
}

/** Colour swatch for a model (identity), always next to the model's name. */
export function ModelDot({ color }: { color: string }) {
  return <span aria-hidden className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />;
}
