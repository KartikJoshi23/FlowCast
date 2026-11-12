import type { Facts, GroundingResult, Interpretation } from "../data/types";

export const INTERPRET_URL = "/api/interpret";
export const CLIENT_TIMEOUT_MS = 45_000;   // below the platform's 60 s function limit

export interface InterpretSuccess {
  interpretation: Interpretation;
  grounding: GroundingResult;
  source: { provider: string; model: string };
  generated_at: string;
  cached: boolean;
}

export type InterpretOutcome =
  | { ok: true; data: InterpretSuccess }
  | { ok: false; code: string; message: string };

/** Call the server-side LLM function. Never throws; every failure becomes a reason for the fallback. */
export async function requestInterpretation(facts: Facts, signal?: AbortSignal): Promise<InterpretOutcome> {
  const timeout = AbortSignal.timeout(CLIENT_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetch(INTERPRET_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ facts }),
      signal: combined,
    });
  } catch (error) {
    if (signal?.aborted) return { ok: false, code: "cancelled", message: "Superseded by newer data." };
    if (timeout.aborted) return { ok: false, code: "timeout", message: "The LLM did not answer within 45 seconds." };
    return { ok: false, code: "network", message: error instanceof Error ? error.message : "Network error." };
  }
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) {
    return { ok: false, code: "unavailable", message: "The interpretation service is not running here (static preview)." };
  }
  const body = (await response.json().catch(() => null)) as (InterpretSuccess & { error?: string; message?: string }) | null;
  if (!response.ok || !body || body.error) {
    return { ok: false, code: body?.error ?? `http_${response.status}`, message: body?.message ?? `The service answered HTTP ${response.status}.` };
  }
  if (!body.interpretation || !body.grounding) return { ok: false, code: "bad_output", message: "Unexpected response from the service." };
  return { ok: true, data: body };
}

export type LlmStatus = { configured: true; model: string } | { configured: false; reason: string };

let statusPromise: Promise<LlmStatus> | null = null;

/** Ask the function once whether an LLM is configured; a static host (no function) counts as "no". */
export function checkLlmStatus(): Promise<LlmStatus> {
  statusPromise ??= (async (): Promise<LlmStatus> => {
    try {
      const response = await fetch(INTERPRET_URL, { method: "GET", signal: AbortSignal.timeout(10_000) });
      const type = response.headers.get("content-type") ?? "";
      if (!response.ok || !type.includes("application/json")) {
        return { configured: false, reason: "The interpretation service is not running here (static preview)." };
      }
      const body = (await response.json()) as { configured?: boolean; model?: string };
      return body.configured
        ? { configured: true, model: body.model ?? "unknown model" }
        : { configured: false, reason: "No LLM API key is configured on the server." };
    } catch {
      return { configured: false, reason: "The interpretation service could not be reached." };
    }
  })();
  return statusPromise;
}

/** Forget the cached status (used by tests). */
export function resetLlmStatus(): void {
  statusPromise = null;
}

/** Stable fingerprint of a facts document (identical facts -> no new request). */
export async function factsHash(facts: Facts): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(facts)));
  return Array.from(new Uint8Array(digest).slice(0, 12), (b) => b.toString(16).padStart(2, "0")).join("");
}
