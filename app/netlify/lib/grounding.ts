/**
 * Grounding check: TypeScript port of the engine's grounding_check() (Python is the reference;
 * shared fixtures prove the two agree). Every number written in an interpretation must come from
 * the facts, allowing only for the rounding actually written; dates, years and small counts are
 * always allowed; every evidence key must exist in the facts.
 */

export interface Interpretation {
  seasonality_trend: { answer: string; evidence: string[] };
  best_model: { answer: string; evidence: string[] };
  recommendations: { title: string; detail: string; evidence: string[] }[];
  caveats: string[];
}

export interface GroundingResult {
  numbers_checked: number;
  unverified_numbers: string[];
  invalid_evidence_keys: string[];
  passed: boolean;
}

const DATE_PATTERN = /\b(?:19|20)\d{2}-(?:0[1-9]|1[0-2])(?:-\d{2})?\b/g;
const CODE_PATTERN = /\b[A-Z]{2}-\d{3}\b/g;
const NUMBER_PATTERN = /(?<![A-Za-z_\d.])[+\-−]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/g;

/**
 * Round half away from zero on the shortest decimal representation of `value`, matching
 * Python's Decimal(repr(x)).quantize(10**-ndigits, ROUND_HALF_UP). Uses integer arithmetic so
 * cases like 1.005 round the way they are written (to 1.01), not the way they are stored.
 */
export function roundHalfUp(value: number, ndigits: number): number {
  if (!Number.isFinite(value) || value === 0) return value;
  const [mantissa, exponentText] = Math.abs(value).toExponential().split("e");
  const digits = mantissa.replace(".", "");
  const exponent = Number(exponentText);
  const coefficient = BigInt(digits);
  const shift = exponent - (digits.length - 1) + ndigits;   // value * 10^ndigits = coefficient * 10^shift
  let scaled: bigint;
  if (shift >= 0) {
    scaled = coefficient * 10n ** BigInt(shift);
  } else {
    const divisor = 10n ** BigInt(-shift);
    scaled = coefficient / divisor;
    if ((coefficient % divisor) * 2n >= divisor) scaled += 1n;
  }
  const magnitude = ndigits >= 0 ? Number(scaled) / 10 ** ndigits : Number(scaled) * 10 ** -ndigits;
  return value < 0 ? -magnitude : magnitude;
}

function numericLeaves(value: unknown, out: Set<number>): void {
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number") out.add(value);
  else if (Array.isArray(value)) value.forEach((v) => numericLeaves(v, out));
  else if (typeof value === "object") Object.values(value as object).forEach((v) => numericLeaves(v, out));
}

export function pathExists(facts: unknown, path: string): boolean {
  let node: unknown = facts;
  for (const part of path.split(".")) {
    if (node && typeof node === "object" && !Array.isArray(node) && part in (node as object)) {
      node = (node as Record<string, unknown>)[part];
    } else if (Array.isArray(node) && /^\d+$/.test(part) && Number(part) < node.length) {
      node = node[Number(part)];
    } else {
      return false;
    }
  }
  return true;
}

function texts(interp: Interpretation): string[] {
  const out = [interp.seasonality_trend.answer, interp.best_model.answer];
  for (const r of interp.recommendations) out.push(r.title, r.detail);
  return out.concat(interp.caveats);
}

function matches(token: string, known: Set<number>): boolean {
  const raw = token.replace(/,/g, "").replace("−", "-").replace(/^\++/, "");
  const value = Number(raw);
  const decimals = raw.includes(".") ? raw.split(".")[1].length : 0;
  if (decimals === 0 && Number.isInteger(value)) {
    const a = Math.abs(value);
    if (a <= 24 || (value >= 2020 && value <= 2030) || a === 80 || a === 95 || a === 100) return true;
  }
  const candidates = new Set<number>(known);
  known.forEach((k) => candidates.add(Math.abs(k)));
  for (const f of candidates) {
    const r = roundHalfUp(f, decimals);
    if (r === Math.abs(value) || r === value) return true;
    if (decimals === 0) {
      const digitsOnly = raw.replace(/^-/, "");
      const zeros = digitsOnly.length - digitsOnly.replace(/0+$/, "").length;
      for (let k = 1; k <= Math.min(zeros, 3); k++) {
        if (Math.abs(f) >= 10 ** k && roundHalfUp(Math.abs(f), -k) === Math.abs(value)) return true;
      }
    }
  }
  return false;
}

export function groundingCheck(interp: Interpretation, facts: unknown): GroundingResult {
  const known = new Set<number>();
  numericLeaves(facts, known);
  const unverified: string[] = [];
  let checked = 0;
  for (const text of texts(interp)) {
    const clean = text.replace(DATE_PATTERN, " ").replace(CODE_PATTERN, " ");
    for (const token of clean.match(NUMBER_PATTERN) ?? []) {
      checked += 1;
      if (!matches(token, known)) unverified.push(token);
    }
  }
  const keyGroups = [interp.seasonality_trend.evidence, interp.best_model.evidence, ...interp.recommendations.map((r) => r.evidence)];
  const badKeys = [...new Set(keyGroups.flat().filter((k) => !pathExists(facts, k)))].sort();
  return { numbers_checked: checked, unverified_numbers: unverified, invalid_evidence_keys: badKeys, passed: !unverified.length && !badKeys.length };
}
