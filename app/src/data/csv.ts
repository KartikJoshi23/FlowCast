import { CHANNELS, REGIONS, SERIES_KEYS, type Panel } from "./types";
import { nextMonth, splitTotal, type SeriesValues } from "./panel";

export const MAX_UNITS = 100_000;

export interface CsvMonth {
  month: string;
  series: SeriesValues;
  /** "edit" replaces an existing month; "add" appends the next month. */
  action: "edit" | "add";
  /** True when only a total was given and it was split by the recent mix. */
  splitFromTotal: boolean;
}

export interface CsvResult {
  months: CsvMonth[];
  errors: string[];
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Parse uploaded monthly data. Accepted layouts (header row required, comma-separated):
 *   month,region,channel,units   (one row per region x channel; all 9 needed per month)
 *   month,total                  (split across the 9 series by the latest 3-month mix)
 * Months must already exist (edits) or continue the data without gaps (additions).
 */
export function parseMonthlyCsv(text: string, current: Panel): CsvResult {
  const errors: string[] = [];
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return { months: [], errors: ["The file needs a header row and at least one data row."] };
  const header = lines[0].toLowerCase().split(",").map((h) => h.trim());
  const long = ["month", "region", "channel", "units"].every((h) => header.includes(h));
  const totals = header.includes("month") && header.includes("total");
  if (!long && !totals) {
    return { months: [], errors: ["Header must be either month,region,channel,units or month,total."] };
  }
  const col = (name: string) => header.indexOf(name);
  const byMonth = new Map<string, { series: SeriesValues; total: number | null }>();

  lines.slice(1).forEach((line, idx) => {
    const cells = line.split(",").map((c) => c.trim());
    const rowNo = idx + 2;
    const month = cells[col("month")];
    if (!MONTH.test(month ?? "")) return void errors.push(`Row ${rowNo}: month must look like 2024-03.`);
    const entry = byMonth.get(month) ?? { series: {}, total: null };
    const parseUnits = (raw: string | undefined) => {
      const value = Number(raw);
      if (raw === undefined || raw === "" || !Number.isFinite(value) || value < 0 || value > MAX_UNITS || !Number.isInteger(value)) {
        errors.push(`Row ${rowNo}: units must be a whole number between 0 and ${MAX_UNITS.toLocaleString("en-US")}.`);
        return null;
      }
      return value;
    };
    if (long) {
      const region = cells[col("region")];
      const channel = cells[col("channel")];
      if (!(REGIONS as readonly string[]).includes(region) || !(CHANNELS as readonly string[]).includes(channel)) {
        return void errors.push(`Row ${rowNo}: unknown region or channel "${region}, ${channel}".`);
      }
      const units = parseUnits(cells[col("units")]);
      if (units !== null) entry.series[`${region}|${channel}`] = units;
    } else {
      const total = parseUnits(cells[col("total")]);
      if (total !== null) entry.total = total;
    }
    byMonth.set(month, entry);
  });

  const months: CsvMonth[] = [];
  const existing = new Set(current.months);
  let expectedNext = nextMonth(current.months[current.months.length - 1]);
  let working = current;
  for (const month of [...byMonth.keys()].sort()) {
    const entry = byMonth.get(month)!;
    let series = entry.series;
    let splitFromTotal = false;
    if (totals) {
      if (entry.total === null) continue;
      series = splitTotal(entry.total, working);
      splitFromTotal = true;
    } else if (SERIES_KEYS.some((k) => !(k in series))) {
      errors.push(`${month}: all 9 region × channel rows are needed (found ${Object.keys(series).length}).`);
      continue;
    }
    if (existing.has(month)) {
      months.push({ month, series, action: "edit", splitFromTotal });
    } else if (month === expectedNext) {
      months.push({ month, series, action: "add", splitFromTotal });
      expectedNext = nextMonth(month);
      working = {
        ...working,
        months: [...working.months, month],
        series: Object.fromEntries(SERIES_KEYS.map((k) => [k, [...(working.series[k] ?? []), series[k]]])),
      };
    } else {
      errors.push(`${month}: months must continue the data without gaps (next expected: ${expectedNext}).`);
    }
  }
  return { months, errors };
}

/** Current data as CSV in the long layout (round-trips through parseMonthlyCsv). */
export function toMonthlyCsv(panel: Panel): string {
  const rows = ["month,region,channel,units"];
  panel.months.forEach((month, i) => {
    for (const key of SERIES_KEYS) {
      const [region, channel] = key.split("|");
      rows.push(`${month},${region},${channel},${panel.series[key][i]}`);
    }
  });
  return rows.join("\n") + "\n";
}
