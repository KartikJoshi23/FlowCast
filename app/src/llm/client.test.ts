import { afterEach, describe, expect, it, vi } from "vitest";
import { checkLlmStatus, factsHash, requestInterpretation, resetLlmStatus } from "./client";

const respond = (status: number, body: unknown, type = "application/json") =>
  vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": type } }));

describe("requestInterpretation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns the server's interpretation on success", async () => {
    vi.stubGlobal("fetch", respond(200, { interpretation: { caveats: [] }, grounding: { passed: true }, source: { provider: "anthropic", model: "m" }, generated_at: "t", cached: false }));
    const outcome = await requestInterpretation({ a: 1 });
    expect(outcome.ok).toBe(true);
  });

  it("passes on the server's error code and message", async () => {
    vi.stubGlobal("fetch", respond(503, { error: "not_configured", message: "No LLM API key is configured." }));
    expect(await requestInterpretation({ a: 1 })).toEqual({ ok: false, code: "not_configured", message: "No LLM API key is configured." });
  });

  it("recognises a static host without the function (HTML instead of JSON)", async () => {
    vi.stubGlobal("fetch", respond(200, "<!doctype html>", "text/html"));
    expect(await requestInterpretation({ a: 1 })).toMatchObject({ ok: false, code: "unavailable" });
  });

  it("reports network failures and cancellations", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    expect(await requestInterpretation({ a: 1 })).toMatchObject({ ok: false, code: "network" });
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new DOMException("aborted", "AbortError"); }));
    expect(await requestInterpretation({ a: 1 }, controller.signal)).toMatchObject({ ok: false, code: "cancelled" });
  });
});

describe("checkLlmStatus", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetLlmStatus();
  });

  it("reads the function's status once and caches it", async () => {
    const fetchMock = respond(200, { configured: true, provider: "anthropic", model: "claude-opus-5-5" });
    vi.stubGlobal("fetch", fetchMock);
    expect(await checkLlmStatus()).toEqual({ configured: true, model: "claude-opus-5-5" });
    await checkLlmStatus();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats a missing key or a static host as not configured", async () => {
    vi.stubGlobal("fetch", respond(200, { configured: false }));
    expect(await checkLlmStatus()).toMatchObject({ configured: false, reason: expect.stringContaining("No LLM API key") });
    resetLlmStatus();
    vi.stubGlobal("fetch", respond(200, "<!doctype html>", "text/html"));
    expect(await checkLlmStatus()).toMatchObject({ configured: false, reason: expect.stringContaining("static preview") });
  });
});

describe("factsHash", () => {
  it("is stable for identical facts and changes with any number", async () => {
    expect(await factsHash({ a: 1, b: [2, 3] })).toBe(await factsHash({ a: 1, b: [2, 3] }));
    expect(await factsHash({ a: 1, b: [2, 3] })).not.toBe(await factsHash({ a: 1, b: [2, 4] }));
  });
});
