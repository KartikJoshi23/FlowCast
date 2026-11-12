/**
 * /api/interpret: turn the engine's facts into a grounded LLM interpretation.
 *
 * POST flow: method/origin/size checks -> JSON body -> facts validation (allowlist) -> API key present?
 * -> cache -> (job already running?) -> rate limit / daily cap -> model call -> grounding check -> cache.
 *
 * Free LLM endpoints can take longer than a synchronous function may run, so when a job runner is
 * available (Netlify Blobs + the background function) the model call runs in the background:
 *   POST                      -> 202 { status: "pending", job }   (job id = the cache key)
 *   GET  ?job=<id>            -> 202 pending | 200 result | error JSON
 *   background POST (signed)  -> runInterpretJob(): model call, grounding, result stored under the job id
 * Without a job runner the model is called synchronously as before.
 *
 * Errors come back as JSON { error, message } with an HTTP status, so the dashboard can show the
 * reason and switch to the rule-based interpretation.
 */
import { validateFacts, type Facts } from "./facts-validation";
import { groundingCheck, type GroundingResult, type Interpretation } from "./grounding";
import type { KeyValueStore, Limits } from "./limits";
import { sha256Hex } from "./limits";
import { ProviderError, type ProviderErrorCode, type ProviderResult } from "./provider-anthropic";

export const MAX_BODY_BYTES = 64 * 1024;
/** A pending job older than this is treated as lost (the background function died) and restarted. */
export const JOB_STALE_MS = 6 * 60_000;

export interface InterpretSuccess {
  interpretation: Interpretation;
  grounding: GroundingResult;
  source: { provider: string; model: string };
  generated_at: string;
  cached: boolean;
}

export interface JobRunner {
  store: KeyValueStore;
  /** Secret used to sign job tokens, so only this endpoint can start a background run. */
  secret: string;
  /** Start the background run; false if it could not be started (then the call is made synchronously). */
  start: (body: { facts: Facts; job: string; token: string }) => Promise<boolean>;
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
  jobs?: JobRunner;
}

type JobRecord =
  | { state: "pending"; started_at: number }
  | { state: "error"; status: number; error: string; message: string };

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

const JOB_ID = /^[0-9a-f]{64}$/;
const jobKey = (job: string) => `jobs/${job}`;
const jobToken = (secret: string, job: string) => sha256Hex(`flowcast-job\n${secret}\n${job}`);

/** Bump to invalidate every cached interpretation (e.g. after changing how answers are chosen). */
const CACHE_VERSION = "3";
const cacheKeyFor =(deps: HandlerDeps, facts: Facts) =>
  sha256Hex(`${CACHE_VERSION}\n${deps.provider}\n${deps.model}\n${deps.promptVersion}\n${JSON.stringify(facts)}`);

async function readJob(store: KeyValueStore, job: string): Promise<JobRecord | null> {
  try {
    const raw = await store.get(jobKey(job));
    return raw ? (JSON.parse(raw) as JobRecord) : null;
  } catch {
    return null;
  }
}

async function writeJob(store: KeyValueStore, job: string, record: JobRecord): Promise<void> {
  try {
    await store.set(jobKey(job), JSON.stringify(record));
  } catch {
    // best effort: the client times out and falls back if the status is lost
  }
}

async function readCached(deps: HandlerDeps, key: string): Promise<InterpretSuccess | null> {
  const cached = await deps.limits.getCached(key);
  if (!cached) return null;
  try {
    return { ...(JSON.parse(cached) as InterpretSuccess), cached: true };
  } catch {
    return null;                                    // ignore a corrupt cache entry and recompute
  }
}

/** Model call + grounding check + cache. Shared by the synchronous path and the background job. */
async function produce(deps: HandlerDeps, facts: Facts, key: string): Promise<InterpretSuccess> {
  const result = await deps.callModel(facts);
  const success: InterpretSuccess = {
    interpretation: result.interpretation,
    grounding: groundingCheck(result.interpretation, facts),
    source: { provider: deps.provider, model: result.model },
    generated_at: deps.now().toISOString(),
    cached: false,
  };
  await deps.limits.putCached(key, JSON.stringify(success));
  return success;
}

const providerFailure = (error: unknown) =>
  error instanceof ProviderError
    ? { status: STATUS_FOR[error.code], error: error.code as string, message: error.message }
    : { status: 503, error: "unavailable", message: "The LLM request failed." };

export async function handleInterpret(request: Request, clientIp: string, deps: HandlerDeps): Promise<Response> {
  if (request.method === "GET") {
    const job = new URL(request.url).searchParams.get("job");
    if (job !== null) return jobStatus(job, deps);
    // Status: whether an LLM is configured (never the key), so the page can skip a doomed POST.
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

  const key = await cacheKeyFor(deps, facts);
  const cached = await readCached(deps, key);
  if (cached) return json(200, cached);

  // The same facts are already being interpreted in the background: just hand back the job id.
  if (deps.jobs) {
    const existing = await readJob(deps.jobs.store, key);
    if (existing?.state === "pending" && deps.now().getTime() - existing.started_at < JOB_STALE_MS) {
      return json(202, { status: "pending", job: key });
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

  if (deps.jobs) {
    await writeJob(deps.jobs.store, key, { state: "pending", started_at: deps.now().getTime() });
    const started = await deps.jobs.start({ facts, job: key, token: await jobToken(deps.jobs.secret, key) }).catch(() => false);
    if (started) return json(202, { status: "pending", job: key });
    await writeJob(deps.jobs.store, key, { state: "error", status: 503, error: "unavailable", message: "Background run could not start." });
  }

  try {
    return json(200, await produce(deps, facts, key));
  } catch (error) {
    const f = providerFailure(error);
    return fail(f.status, f.error, f.message);
  }
}

async function jobStatus(job: string, deps: HandlerDeps): Promise<Response> {
  if (!JOB_ID.test(job)) return fail(400, "bad_job", "Unknown job id format.");
  const cached = await readCached(deps, job);
  if (cached) return json(200, { ...cached, cached: false });
  if (!deps.jobs) return fail(404, "unknown_job", "No such interpretation job.");
  const record = await readJob(deps.jobs.store, job);
  if (!record) return fail(404, "unknown_job", "No such interpretation job.");
  if (record.state === "error") return fail(record.status, record.error, record.message);
  if (deps.now().getTime() - record.started_at > JOB_STALE_MS) {
    return fail(504, "timeout", "The background interpretation did not finish.");
  }
  return json(202, { status: "pending", job });
}

/**
 * Background entry point: runs one signed job and stores its outcome. Returns a short status
 * string for logging (a background function's response is discarded by the platform).
 */
export async function runInterpretJob(request: Request, deps: HandlerDeps): Promise<string> {
  if (request.method !== "POST" || !deps.jobs) return "ignored";
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return "too_large";
  let body: { facts?: unknown; job?: unknown; token?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return "bad_json";
  }
  if (typeof body.job !== "string" || !JOB_ID.test(body.job) || typeof body.token !== "string") return "bad_job";
  if (body.token !== (await jobToken(deps.jobs.secret, body.job))) return "bad_token";
  const checked = validateFacts(body.facts);
  if (!checked.ok) return "invalid_facts";
  const key = await cacheKeyFor(deps, checked.facts);
  if (key !== body.job) return "job_mismatch";
  if (!deps.apiKey) {
    await writeJob(deps.jobs.store, key, { state: "error", status: 503, error: "not_configured", message: "No LLM API key is configured on the server." });
    return "not_configured";
  }
  try {
    await produce(deps, checked.facts, key);
    return "done";
  } catch (error) {
    const f = providerFailure(error);
    await writeJob(deps.jobs.store, key, { state: "error", ...f });
    return f.error;
  }
}
