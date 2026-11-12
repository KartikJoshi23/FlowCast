import type { Interpretation } from "./grounding";

const MAX_ANSWER = 2500;
const MAX_ITEMS = 6;
const MAX_EVIDENCE = 40;

const isText = (v: unknown, max: number): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const isEvidence = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length <= MAX_EVIDENCE && v.every((k) => typeof k === "string" && k.length <= 120);

/** Strict shape check of the model's JSON (the schema guarantees the shape; this guards the sizes). */
export function validateInterpretation(value: unknown): Interpretation | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const section = (s: unknown) => {
    if (!s || typeof s !== "object") return false;
    const o = s as Record<string, unknown>;
    return isText(o.answer, MAX_ANSWER) && isEvidence(o.evidence);
  };
  if (!section(v.seasonality_trend) || !section(v.best_model)) return null;
  if (!Array.isArray(v.recommendations) || v.recommendations.length < 1 || v.recommendations.length > MAX_ITEMS) return null;
  for (const r of v.recommendations) {
    const o = r as Record<string, unknown>;
    if (!o || !isText(o.title, 160) || !isText(o.detail, 1200) || !isEvidence(o.evidence)) return null;
  }
  if (!Array.isArray(v.caveats) || v.caveats.length > MAX_ITEMS || !v.caveats.every((c) => isText(c, 600))) return null;
  return value as Interpretation;
}

/**
 * Parse model text as JSON. Tolerates what open models add around it: a code fence,
 * a <think>...</think> reasoning block, or a sentence before/after the object.
 */
export function parseInterpretation(text: string): Interpretation | null {
  let body = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  if (body.startsWith("```")) body = body.replace(/^```[a-z]*\s*/i, "").replace(/```\s*$/, "");
  const first = body.indexOf("{");
  const last = body.lastIndexOf("}");
  if (first < 0 || last <= first) return null;
  try {
    return validateInterpretation(JSON.parse(body.slice(first, last + 1)));
  } catch {
    return null;
  }
}
