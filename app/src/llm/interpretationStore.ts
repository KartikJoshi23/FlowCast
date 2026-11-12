import { useEffect } from "react";
import { create } from "zustand";
import type { Analysis, GroundingResult, Interpretation } from "../data/types";
import { useApp } from "../state/store";
import { checkLlmStatus, factsHash, requestInterpretation } from "./client";

export const AUTO_DEBOUNCE_MS = 1500;
export const MIN_AUTO_INTERVAL_MS = 10_000;

export type InterpretationSource =
  | { kind: "llm"; model: string; cached: boolean }
  | { kind: "rule-based"; code: string; reason: string };

interface InterpretationState {
  status: "idle" | "loading" | "ready";
  interpretation: Interpretation | null;
  grounding: GroundingResult | null;
  source: InterpretationSource | null;
  generatedAt: string | null;
  /** Data the interpretation describes ("data through" month and month count). */
  basis: { dataThrough: string; months: number; level: string } | null;
  hash: string | null;
  lastRequestAt: number;
  generate: (analysis: Analysis, options?: { force?: boolean }) => Promise<void>;
}

let controller: AbortController | null = null;

/**
 * Interpretation state. The LLM is called only through `generate` (debounced by the hook below,
 * de-duplicated by facts hash). Any failure falls back to the engine's rule-based interpretation,
 * labelled with the reason, so the panel always answers the three questions.
 */
export const useInterpretation = create<InterpretationState>()((set, get) => ({
  status: "idle",
  interpretation: null,
  grounding: null,
  source: null,
  generatedAt: null,
  basis: null,
  hash: null,
  lastRequestAt: 0,

  generate: async (analysis, options = {}) => {
    const hash = await factsHash(analysis.facts);
    const state = get();
    if (!options.force && hash === state.hash && state.status !== "idle") return;
    controller?.abort();
    controller = new AbortController();
    const basis = {
      dataThrough: analysis.result.meta.data_through,
      months: analysis.result.meta.n_months,
      level: analysis.result.meta.level_label,
    };
    set({ status: "loading", hash, lastRequestAt: Date.now() });
    const status = await checkLlmStatus();
    const outcome = status.configured
      ? await requestInterpretation(analysis.facts, controller.signal)
      : ({ ok: false, code: "not_configured", message: status.reason } as const);
    if (!outcome.ok && outcome.code === "cancelled") return;
    if (get().hash !== hash) return;                       // newer data arrived meanwhile
    if (outcome.ok) {
      set({
        status: "ready",
        interpretation: outcome.data.interpretation,
        grounding: outcome.data.grounding,
        source: { kind: "llm", model: outcome.data.source.model, cached: outcome.data.cached },
        generatedAt: outcome.data.generated_at,
        basis,
      });
    } else {
      set({
        status: "ready",
        interpretation: analysis.rule_based,
        grounding: analysis.rule_based_grounding,
        source: { kind: "rule-based", code: outcome.code, reason: outcome.message },
        generatedAt: new Date().toISOString(),
        basis,
      });
    }
  },
}));

/**
 * Keep the interpretation in step with the data while an interpretation is on screen:
 * debounced after each new analysis, at most one automatic request every 10 s, none while
 * `paused` (e.g. the live feed is playing). Unmounted -> no requests (and no cost).
 */
export function useAutoInterpretation(paused = false) {
  const analysis = useApp((s) => s.analysis);
  const generate = useInterpretation((s) => s.generate);
  useEffect(() => {
    if (!analysis || paused) return;
    const since = Date.now() - useInterpretation.getState().lastRequestAt;
    const wait = Math.max(AUTO_DEBOUNCE_MS, MIN_AUTO_INTERVAL_MS - since);
    const first = useInterpretation.getState().status === "idle";
    const timer = setTimeout(() => void generate(analysis), first ? 0 : wait);
    return () => clearTimeout(timer);
  }, [analysis, paused, generate]);
}
