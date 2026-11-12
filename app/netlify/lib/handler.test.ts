import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Interpretation } from "./grounding";
import { handleInterpret, runInterpretJob, type HandlerDeps, type JobRunner } from "./handler";
import { createLimits, memoryStore, type KeyValueStore } from "./limits";
import { ProviderError, type ProviderResult } from "./provider-anthropic";

const fixtures = JSON.parse(readFileSync(new URL("./__fixtures__/llm-fixtures.json", import.meta.url), "utf8")) as {
  facts_samples: { facts: Record<string, unknown>; rule_based: Interpretation }[];
};
const sample = fixtures.facts_samples[0];
const URL_ = "https://flowcast.example/api/interpret";

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request(URL_, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

describe("handleInterpret", () => {
  let deps: HandlerDeps;
  let callModel: ReturnType<typeof vi.fn<(facts: unknown) => Promise<ProviderResult>>>;

  beforeEach(() => {
    callModel = vi.fn<(facts: unknown) => Promise<ProviderResult>>(async () => ({ interpretation: sample.rule_based, model: "claude-opus-5-5" }));
    deps = {
      apiKey: "test-key",
      provider: "anthropic",
      model: "claude-opus-5-5",
      promptVersion: "v1",
      limits: createLimits(memoryStore(), { perMinute: 6, dailyCap: 200 }),
      callModel,
      now: () => new Date("2026-11-12T10:00:00Z"),
    };
  });

  it("returns a grounded interpretation and serves repeats from the cache", async () => {
    const first = await handleInterpret(post({ facts: sample.facts }), "1.2.3.4", deps);
    expect(first.status).toBe(200);
    const body = await first.json();
    expect(body.grounding.passed).toBe(true);
    expect(body.source).toEqual({ provider: "anthropic", model: "claude-opus-5-5" });
    expect(body.cached).toBe(false);
    const second = await handleInterpret(post({ facts: sample.facts }), "1.2.3.4", deps);
    expect((await second.json()).cached).toBe(true);
    expect(callModel).toHaveBeenCalledTimes(1);
    expect(first.headers.get("cache-control")).toBe("no-store");
  });

  it("flags figures the model invented", async () => {
    const invented = structuredClone(sample.rule_based);
    invented.best_model.answer += " This saves 98,765 units.";
    callModel.mockResolvedValueOnce({ interpretation: invented, model: "claude-opus-5-5" });
    const body = await (await handleInterpret(post({ facts: sample.facts }), "1.2.3.4", deps)).json();
    expect(body.grounding.passed).toBe(false);
    expect(body.grounding.unverified_numbers).toContain("98,765");
  });

  it("reports its status on GET without revealing the key", async () => {
    const configured = await (await handleInterpret(new Request(URL_), "1.2.3.4", deps)).json();
    expect(configured).toEqual({ configured: true, provider: "anthropic", model: "claude-opus-5-5" });
    expect(JSON.stringify(configured)).not.toContain("test-key");
    const missing = await (await handleInterpret(new Request(URL_), "1.2.3.4", { ...deps, apiKey: undefined })).json();
    expect(missing.configured).toBe(false);
  });

  it.each([
    ["PUT request", new Request(URL_, { method: "PUT", body: "{}" }), 405, "method_not_allowed"],
    ["foreign origin", post({ facts: sample.facts }, { origin: "https://evil.example" }), 403, "forbidden_origin"],
    ["bad JSON", post("{not json"), 400, "bad_json"],
    ["invalid facts", post({ facts: { context: { product: "hello" } } }), 422, "invalid_facts"],
  ])("rejects %s", async (_name, request, status, error) => {
    const response = await handleInterpret(request as Request, "1.2.3.4", deps);
    expect(response.status).toBe(status);
    expect((await response.json()).error).toBe(error);
    expect(callModel).not.toHaveBeenCalled();
  });

  it("explains a missing API key without calling the model", async () => {
    const response = await handleInterpret(post({ facts: sample.facts }), "1.2.3.4", { ...deps, apiKey: undefined });
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe("not_configured");
    expect(callModel).not.toHaveBeenCalled();
  });

  it.each([
    ["timeout", 504], ["rate_limited", 429], ["refused", 422], ["bad_output", 502], ["auth", 503], ["unavailable", 503],
  ] as const)("maps provider error %s to HTTP %s", async (code, status) => {
    callModel.mockRejectedValueOnce(new ProviderError(code, `simulated ${code}`));
    const response = await handleInterpret(post({ facts: sample.facts }), "1.2.3.4", deps);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: code, message: `simulated ${code}` });
  });

  it("enforces the per-minute limit per client and the daily cap", async () => {
    const tight = { ...deps, limits: createLimits(memoryStore(), { perMinute: 1, dailyCap: 2 }) };
    const facts2 = structuredClone(sample.facts) as Record<string, any>;
    facts2.trend.latest_units += 1;                 // different facts -> not a cache hit
    const facts3 = structuredClone(sample.facts) as Record<string, any>;
    facts3.trend.latest_units += 2;
    expect((await handleInterpret(post({ facts: sample.facts }), "1.1.1.1", tight)).status).toBe(200);
    const limited = await handleInterpret(post({ facts: facts2 }), "1.1.1.1", tight);
    expect(limited.status).toBe(429);
    expect((await limited.json()).error).toBe("rate_limited");
    expect(limited.headers.get("retry-after")).toBeTruthy();
    expect((await handleInterpret(post({ facts: facts2 }), "2.2.2.2", tight)).status).toBe(200);
    const capped = await handleInterpret(post({ facts: facts3 }), "3.3.3.3", tight);
    expect((await capped.json()).error).toBe("daily_cap");
  });

  it("keeps working when the storage layer fails", async () => {
    const broken: KeyValueStore = { get: async () => { throw new Error("down"); }, set: async () => { throw new Error("down"); } };
    const response = await handleInterpret(post({ facts: sample.facts }), "1.2.3.4", { ...deps, limits: createLimits(broken, { perMinute: 6, dailyCap: 200 }) });
    expect(response.status).toBe(200);
  });
});

describe("background jobs", () => {
  let deps: HandlerDeps;
  let callModel: ReturnType<typeof vi.fn<(facts: unknown) => Promise<ProviderResult>>>;
  let started: { facts: unknown; job: string; token: string }[];
  let store: KeyValueStore;

  beforeEach(() => {
    callModel = vi.fn<(facts: unknown) => Promise<ProviderResult>>(async () => ({ interpretation: sample.rule_based, model: "openai/gpt-oss-20b" }));
    started = [];
    store = memoryStore();
    const jobs: JobRunner = { store, secret: "job-secret", start: async (body) => { started.push(body); return true; } };
    deps = {
      apiKey: "test-key", provider: "nvidia", model: "openai/gpt-oss-20b", promptVersion: "v1",
      limits: createLimits(store, { perMinute: 6, dailyCap: 200 }), callModel,
      now: () => new Date("2026-11-12T10:00:00Z"), jobs,
    };
  });

  const runRequest = (body: unknown) =>
    new Request("https://flowcast.example/api/interpret-run", { method: "POST", body: JSON.stringify(body) });
  const poll = (job: string) => handleInterpret(new Request(`${URL_}?job=${job}`), "1.2.3.4", deps);

  it("answers 202 with a job, runs it in the background and serves the result by polling", async () => {
    const first = await handleInterpret(post({ facts: sample.facts }), "1.2.3.4", deps);
    expect(first.status).toBe(202);
    const { job } = await first.json();
    expect(job).toMatch(/^[0-9a-f]{64}$/);
    expect(callModel).not.toHaveBeenCalled();
    expect((await poll(job)).status).toBe(202);

    // A repeat POST while the job runs does not start a second run or use the rate limit.
    expect((await handleInterpret(post({ facts: sample.facts }), "1.2.3.4", deps)).status).toBe(202);
    expect(started).toHaveLength(1);

    expect(await runInterpretJob(runRequest(started[0]), deps)).toBe("done");
    const done = await poll(job);
    expect(done.status).toBe(200);
    const body = await done.json();
    expect(body.grounding.passed).toBe(true);
    expect(body.source).toEqual({ provider: "nvidia", model: "openai/gpt-oss-20b" });
    expect((await (await handleInterpret(post({ facts: sample.facts }), "1.2.3.4", deps)).json()).cached).toBe(true);
  });

  it("stores a failed run as an error the poll reports", async () => {
    const { job } = await (await handleInterpret(post({ facts: sample.facts }), "1.2.3.4", deps)).json();
    callModel.mockRejectedValueOnce(new ProviderError("timeout", "The LLM did not answer in time."));
    expect(await runInterpretJob(runRequest(started[0]), deps)).toBe("timeout");
    const failed = await poll(job);
    expect(failed.status).toBe(504);
    expect((await failed.json()).error).toBe("timeout");
  });

  it("ignores background requests without a valid token or with other facts", async () => {
    await handleInterpret(post({ facts: sample.facts }), "1.2.3.4", deps);
    const valid = started[0];
    expect(await runInterpretJob(runRequest({ ...valid, token: "0".repeat(64) }), deps)).toBe("bad_token");
    const other = structuredClone(sample.facts) as Record<string, any>;
    other.trend.latest_units += 1;
    expect(await runInterpretJob(runRequest({ ...valid, facts: other }), deps)).toBe("job_mismatch");
    expect(callModel).not.toHaveBeenCalled();
  });

  it("rejects malformed and unknown job ids", async () => {
    expect((await poll("../etc")).status).toBe(400);
    expect((await poll("a".repeat(64))).status).toBe(404);
  });

  it("falls back to a direct call when the background run cannot start", async () => {
    deps.jobs = { ...deps.jobs!, start: async () => false };
    const response = await handleInterpret(post({ facts: sample.facts }), "1.2.3.4", deps);
    expect(response.status).toBe(200);
    expect(callModel).toHaveBeenCalledTimes(1);
  });
});
