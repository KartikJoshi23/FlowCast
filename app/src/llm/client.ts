import type { Facts, GroundingResult, Interpretation } from "../data/types";

export const INTERPRET_URL = "/api/interpret";
/** Total wait for an interpretation, including the background run on slow free endpoints. */
export const CLIENT_TIMEOUT_MS = 260_000;
export const POLL_INTERVAL_MS = 2_500;

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

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });

/** Call the server-side LLM function. Never throws; every failure becomes a reason for the fallback. */
export async function requestInterpretation(facts: Facts, signal?: AbortSignal, options: { fresh?: boolean } = {}): Promise<InterpretOutcome> {
  const timeout = AbortSignal.timeout(CLIENT_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetch(INTERPRET_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(options.fresh ? { facts, fresh: true } : { facts }),
      signal: combined,
    });
  } catch (error) {
    if (signal?.aborted) return { ok: false, code: "cancelled", message: "Superseded by newer data." };
    if (timeout.aborted) return { ok: false, code: "timeout", message: "The LLM did not answer within 260 seconds." };
    return { ok: false, code: "network", message: error instanceof Error ? error.message : "Network error." };
  }
  let outcome = await readOutcome(response);
  // 202: the model runs in a background function; poll the job until it finishes.
  while ("pending" in outcome) {
    const job = outcome.pending;
    try {
      await sleep(POLL_INTERVAL_MS, combined);
      response = await fetch(`${INTERPRET_URL}?job=${encodeURIComponent(job)}`, { method: "GET", signal: combined });
    } catch (error) {
      if (signal?.aborted) return { ok: false, code: "cancelled", message: "Superseded by newer data." };
      if (timeout.aborted) return { ok: false, code: "timeout", message: "The LLM did not answer within 260 seconds." };
      return { ok: false, code: "network", message: error instanceof Error ? error.message : "Network error." };
    }
    outcome = await readOutcome(response);
  }
  return outcome;
}

type Body = InterpretSuccess & { error?: string; message?: string; status?: string; job?: string };

async function readOutcome(response: Response): Promise<InterpretOutcome | { pending: string }> {
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) {
    // HTML or 404: a static host without the function. Anything else: the function itself failed.
    const missing = response.ok || response.status === 404;
    return missing
      ? { ok: false, code: "unavailable", message: "The interpretation service is not running here (static preview)." }
      : { ok: false, code: `http_${response.status}`, message: `The interpretation service failed (HTTP ${response.status}).` };
  }
  const body = (await response.json().catch(() => null)) as Body | null;
  if (response.status === 202 && body?.status === "pending" && typeof body.job === "string") return { pending: body.job };
  if (!response.ok || !body || body.error) {
    return { ok: false, code: body?.error ?? `http_${response.status}`, message: body?.message ?? `The service answered HTTP ${response.status}.` };
  }
  if (!body.interpretation || !body.grounding) return { ok: false, code: "bad_output", message: "Unexpected response from the service." };
  return { ok: true, data: body };
}

export type LlmStatus = { configured: true; model: string } | { configured: false; reason: string };

let statusPromise: Promise<LlmStatus> | null = null;

/**
 * Ask the function whether an LLM is configured; a static host (no function) counts as "no".
 * A definite answer is remembered for the session; a failed check (network error, a deploy in
 * progress) is not, so the next interpretation asks again instead of staying rule-based.
 */
export function checkLlmStatus(): Promise<LlmStatus> {
  if (statusPromise) return statusPromise;
  const check = async (): Promise<{ status: LlmStatus; definite: boolean }> => {
    try {
      const response = await fetch(INTERPRET_URL, { method: "GET", signal: AbortSignal.timeout(10_000) });
      const type = response.headers.get("content-type") ?? "";
      if (!type.includes("application/json")) {
        const missing = response.ok || response.status === 404;     // a static host without the function
        return missing
          ? { status: { configured: false, reason: "The interpretation service is not running here (static preview)." }, definite: true }
          : { status: { configured: false, reason: `The interpretation service failed (HTTP ${response.status}).` }, definite: false };
      }
      if (!response.ok) {
        return { status: { configured: false, reason: `The interpretation service failed (HTTP ${response.status}).` }, definite: false };
      }
      const body = (await response.json()) as { configured?: boolean; model?: string };
      return body.configured
        ? { status: { configured: true, model: body.model ?? "unknown model" }, definite: true }
        : { status: { configured: false, reason: "No LLM API key is configured on the server." }, definite: true };
    } catch {
      return { status: { configured: false, reason: "The interpretation service could not be reached." }, definite: false };
    }
  };
  const pending = check().then(({ status, definite }) => {
    if (!definite) statusPromise = null;                              // ask again next time
    return status;
  });
  statusPromise = pending;
  return pending;
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
