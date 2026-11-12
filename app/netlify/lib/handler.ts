/**
 * POST /api/interpret: turn the engine's facts into a grounded LLM interpretation.
 *
 * Flow: method/origin/size checks -> JSON body -> facts validation (allowlist) -> API key present?
 * -> cache -> rate limit / daily cap -> model call -> grounding check -> cache -> response.
 * Errors come back as JSON { error, message } with an HTTP status, so the dashboard can show
 * the reason and switch to the rule-based interpretation.
 */
import { validateFacts, type Facts } from "./facts-validation";
import { groundingCheck, type GroundingResult, type Interpretation } from "./grounding";
import type { Limits } from "./limits";
import { sha256Hex } from "./limits";
import { ProviderError, type ProviderErrorCode, type ProviderResult } from "./provider-anthropic";

export const MAX_BODY_BYTES = 64 * 1024;

export interface InterpretSuccess {
  interpretation: Interpretation;
  grounding: GroundingResult;
  source: { provider: string; model: string };
  generated_at: string;
  cached: boolean;
}

export interface HandlerDeps {
  apiKey: string | undefined;
  /** "nvidia" or "anthropic"; reported to the page, never the key. */
  provider: string;
  model: string;
  promptVersion: string;
  limits: Limits;
  callModel: (facts: Facts) => Promise<ProviderResult>;
  now: () => Date;
}

const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });

const fail = (status: number, error: string, message: string, extra?: Record<string, string>) =>
  json(status, { error, message }, extra);

const STATUS_FOR: Record<ProviderErrorCode, number> = {
  not_configured: 503,
  auth: 503,
  rate_limited: 429,
  timeout: 504,
  refused: 422,
  truncated: 502,
  bad_output: 502,
  unavailable: 503,
};

export async function handleInterpret(request: Request, clientIp: string, deps: HandlerDeps): Promise<Response> {
  // GET reports whether an LLM is configured (never the key), so the page can skip a doomed POST.
  if (request.method === "GET") {
    return json(200, { configured: Boolean(deps.apiKey), provider: deps.provider, model: deps.model });
  }
  if (request.method !== "POST") return fail(405, "method_not_allowed", "Use GET or POST.", { allow: "GET, POST" });

  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return fail(403, "forbidden_origin", "This endpoint only serves the dashboard it is deployed with.");
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return fail(413, "too_large", "Request body too large.");

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return fail(400, "bad_json", "Request body must be JSON.");
  }
  const checked = validateFacts((body as { facts?: unknown } | null)?.facts);
  if (!checked.ok) return fail(422, "invalid_facts", `Facts rejected: ${checked.error}.`);
  const facts = checked.facts;

  if (!deps.apiKey) {
    return fail(503, "not_configured", "No LLM API key is configured on the server; showing the rule-based interpretation.");
  }

  const cacheKey = await sha256Hex(`${deps.model}\n${deps.promptVersion}\n${JSON.stringify(facts)}`);
  const cached = await deps.limits.getCached(cacheKey);
  if (cached) {
    try {
      return json(200, { ...(JSON.parse(cached) as InterpretSuccess), cached: true });
    } catch {
      // ignore a corrupt cache entry and recompute
    }
  }

  const clientId = (await sha256Hex(clientIp || "unknown")).slice(0, 16);   // never store raw IPs
  const admitted = await deps.limits.admit(clientId, deps.now());
  if (!admitted.ok) {
    const message = admitted.reason === "daily_cap"
      ? "The daily LLM budget for this dashboard is used up."
      : "Too many interpretation requests; please wait a moment.";
    return fail(429, admitted.reason, message, { "retry-after": String(admitted.retryAfterSeconds) });
  }

  let result: ProviderResult;
  try {
    result = await deps.callModel(facts);
  } catch (error) {
    if (error instanceof ProviderError) return fail(STATUS_FOR[error.code], error.code, error.message);
    return fail(503, "unavailable", "The LLM request failed.");
  }

  const success: InterpretSuccess = {
    interpretation: result.interpretation,
    grounding: groundingCheck(result.interpretation, facts),
    source: { provider: deps.provider, model: result.model },
    generated_at: deps.now().toISOString(),
    cached: false,
  };
  await deps.limits.putCached(cacheKey, JSON.stringify(success));
  return json(200, success);
}
