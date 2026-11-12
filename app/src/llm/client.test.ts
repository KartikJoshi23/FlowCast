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

  it("polls a background job until the result is ready", async () => {
    vi.useFakeTimers();
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(202, { status: "pending", job: "abc" }))
      .mockResolvedValueOnce(json(202, { status: "pending", job: "abc" }))
      .mockResolvedValueOnce(json(200, { interpretation: { caveats: [] }, grounding: { passed: true }, source: { provider: "nvidia", model: "m" }, generated_at: "t", cached: false }));
    vi.stubGlobal("fetch", fetchMock);
    const pending = requestInterpretation({ a: 1 });
    await vi.advanceTimersByTimeAsync(6_000);
    expect(await pending).toMatchObject({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][0]).toBe("/api/interpret?job=abc");
    vi.useRealTimers();
  });

  it("reports a failed background job", async () => {
    vi.useFakeTimers();
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(json(202, { status: "pending", job: "abc" }))
      .mockResolvedValueOnce(json(504, { error: "timeout", message: "The LLM did not answer in time." })));
    const pending = requestInterpretation({ a: 1 });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await pending).toEqual({ ok: false, code: "timeout", message: "The LLM did not answer in time." });
    vi.useRealTimers();
  });

  it("tells a crashed function apart from a static host", async () => {
    vi.stubGlobal("fetch", respond(502, "upstream error", "text/plain"));
    expect(await requestInterpretation({ a: 1 })).toEqual({ ok: false, code: "http_502", message: "The interpretation service failed (HTTP 502)." });
  });

  it("sends fresh: true only when asked", async () => {
    const fetchMock = respond(503, { error: "x", message: "y" });
    vi.stubGlobal("fetch", fetchMock);
    await requestInterpretation({ a: 1 }, undefined, { fresh: true });
    await requestInterpretation({ a: 1 });
    expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({ facts: { a: 1 }, fresh: true });
    expect(JSON.parse(String((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body))).toEqual({ facts: { a: 1 } });
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

  it("does not remember a failed check, so the next interpretation asks again", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    expect(await checkLlmStatus()).toMatchObject({ configured: false, reason: expect.stringContaining("could not be reached") });
    const fetchMock = respond(200, { configured: true, provider: "nvidia", model: "m" });
    vi.stubGlobal("fetch", fetchMock);
    expect(await checkLlmStatus()).toEqual({ configured: true, model: "m" });
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
