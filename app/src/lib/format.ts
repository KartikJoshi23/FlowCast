const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2023-05" -> "May 2023" */
export function fmtMonth(month: string): string {
  const [y, m] = month.split("-");
  return `${MONTHS[Number(m) - 1]} ${y}`;
}

/** "2023-05" -> "May '23" (compact axis labels) */
export function fmtMonthShort(month: string): string {
  const [y, m] = month.split("-");
  return `${MONTHS[Number(m) - 1]} '${y.slice(2)}`;
}

/** Whole units with thousands separators; "n/a" for missing. */
export function fmtUnits(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  return Math.round(value).toLocaleString("en-US");
}

/** Percentage with one decimal (optionally signed). */
export function fmtPct(value: number | null | undefined, signed = false): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  const text = `${Math.abs(value).toFixed(1)}%`;
  if (!signed) return value < 0 ? `-${text}` : text;
  return value > 0 ? `+${text}` : value < 0 ? `−${text}` : text;
}

/** Milliseconds as a short human duration. */
export function fmtDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "n/a";
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** "total" -> "all regions and channels"; "region:PL-North" -> "region PL-North". */
export function levelPhrase(level: string): string {
  if (level === "total") return "all regions and channels";
  const [kind, name] = level.split(":");
  return `${kind} ${name}`;
}

/** Relative deviation in scientific notation for the parity report. */
export function fmtDeviation(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  if (value === 0) return "0 (exact)";
  return value.toExponential(1);
}
