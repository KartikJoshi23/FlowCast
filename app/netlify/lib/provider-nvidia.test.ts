import { describe, expect, it, vi } from "vitest";
import fixtures from "./__fixtures__/llm-fixtures.json";
import type { Facts } from "./facts-validation";
import { ProviderError } from "./provider-anthropic";
import { buildNvidiaRequest, interpretWithNvidia } from "./provider-nvidia";

const sample = (fixtures as unknown as { facts_samples: { facts: Facts; rule_based: unknown }[] }).facts_samples[0];
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const ok = (content: string, finish = "stop") => reply(200, { model: "meta/llama-3.3-70b-instruct", choices: [{ finish_reason: finish, message: { content } }] });
const opts = (fetchImpl: unknown) => ({ apiKey: "nvapi-test", model: "meta/llama-3.3-70b-instruct", timeoutMs: 5000, fetchImpl: fetchImpl as (input: string, init: RequestInit) => Promise<Response> });

describe("NVIDIA provider", () => {
  it("builds an OpenAI-compatible request with the notebook prompt and the speed options", () => {
    const req = buildNvidiaRequest(sample.facts, "deepseek-ai/x", "fast");
    expect(req.messages[0].role).toBe("system");
    expect(req.messages[1].content).toContain(JSON.stringify(sample.facts));
    expect(req.messages[1].content).toContain("JSON schema");
    expect(req).toMatchObject({ chat_template_kwargs: { thinking: false } });
    expect(buildNvidiaRequest(sample.facts, "openai/gpt-oss-20b", "fast")).toMatchObject({ reasoning_effort: "low" });
    const plain = buildNvidiaRequest(sample.facts, "deepseek-ai/x", "plain");
    expect("chat_template_kwargs" in plain || "reasoning_effort" in plain).toBe(false);
  });

  it("returns a parsed interpretation and sends the key only in the header", async () => {
    const fetchImpl = vi.fn(async () => ok("```json\n" + JSON.stringify(sample.rule_based) + "\n```"));
    const result = await interpretWithNvidia(sample.facts, opts(fetchImpl));
    expect(result.interpretation).toEqual(sample.rule_based);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://integrate.api.nvidia.com/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer nvapi-test");
    expect(String(init.body)).not.toContain("nvapi-test");
  });

  it("retries without the speed options when the model rejects them", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(reply(400, { detail: "unsupported option" }))
      .mockResolvedValueOnce(ok(JSON.stringify(sample.rule_based)));
    await interpretWithNvidia(sample.facts, opts(fetchImpl));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(String((fetchImpl.mock.calls[1][1] as RequestInit).body)).not.toContain("chat_template_kwargs");
  });

  it("moves to the next model when one is retired (HTTP 410)", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(reply(410, { detail: "gone" }))
      .mockResolvedValueOnce(ok(JSON.stringify(sample.rule_based)));
    const result = await interpretWithNvidia(sample.facts, { ...opts(fetchImpl), model: "old/model, new/model" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(String((fetchImpl.mock.calls[1][1] as RequestInit).body)).toContain('"model":"new/model"');
    expect(result.interpretation).toEqual(sample.rule_based);
  });

  it("moves on when a model is too slow, within the overall deadline", async () => {
    const slow = (_u: string, init: RequestInit) => new Promise<Response>((_, reject) => {
      init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "TimeoutError" })));
    });
    const fetchImpl = vi.fn().mockImplementationOnce(slow).mockResolvedValueOnce(ok(JSON.stringify(sample.rule_based)));
    const result = await interpretWithNvidia(sample.facts, { ...opts(fetchImpl), model: "slow/model,fast/model", timeoutMs: 2000, perModelMs: 50 });
    expect(result.model).toBe("meta/llama-3.3-70b-instruct");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("names each model's outcome and time when all fail", async () => {
    const fetchImpl = vi.fn(async () => reply(500, {}));
    await expect(interpretWithNvidia(sample.facts, { ...opts(fetchImpl), model: "a/one,b/two" }))
      .rejects.toThrow(/one: unavailable after \d+\.\d s; two: unavailable after/);
  });

  it("stops at once on a rejected key", async () => {
    const fetchImpl = vi.fn(async () => reply(401, {}));
    await expect(interpretWithNvidia(sample.facts, { ...opts(fetchImpl), model: "a/b,c/d" })).rejects.toMatchObject({ code: "auth" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reports when every model is retired", async () => {
    const fetchImpl = vi.fn(async () => reply(410, {}));
    await expect(interpretWithNvidia(sample.facts, { ...opts(fetchImpl), model: "a/b,c/d" })).rejects.toMatchObject({ code: "unavailable" });
  });

  it("parses JSON wrapped in reasoning text", async () => {
    const fetchImpl = vi.fn(async () => ok("<think>planning...</think>\nHere it is:\n" + JSON.stringify(sample.rule_based) + "\nDone."));
    expect((await interpretWithNvidia(sample.facts, opts(fetchImpl))).interpretation).toEqual(sample.rule_based);
  });

  it.each([
    [reply(401, {}), "auth"],
    [reply(429, {}), "rate_limited"],
    [reply(500, {}), "unavailable"],
    [ok("not json"), "bad_output"],
    [ok("{", "length"), "truncated"],
  ] as const)("maps failures to ProviderError codes (%#)", async (response, code) => {
    const fetchImpl = vi.fn(async () => response.clone());
    await expect(interpretWithNvidia(sample.facts, opts(fetchImpl))).rejects.toMatchObject({ code });
  });

  it("maps network failures", async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError("fetch failed"); });
    await expect(interpretWithNvidia(sample.facts, opts(fetchImpl))).rejects.toBeInstanceOf(ProviderError);
  });
});
