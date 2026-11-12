import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { buildRequest, interpretWithClaude, ProviderError } from "./provider-anthropic";

const fixtures = JSON.parse(readFileSync(new URL("./__fixtures__/llm-fixtures.json", import.meta.url), "utf8")) as {
  facts_samples: { facts: Record<string, unknown>; rule_based: unknown }[];
};
const facts = fixtures.facts_samples[0].facts;
const goodText = JSON.stringify(fixtures.facts_samples[0].rule_based);

const message = (text: string | null, stop_reason = "end_turn") => ({
  model: "claude-opus-5-5",
  stop_reason,
  content: text === null ? [] : [{ type: "thinking", thinking: "" }, { type: "text", text }],
});

function fakeClient(beta: () => Promise<unknown>, plain: () => Promise<unknown> = beta) {
  const betaCreate = vi.fn((_request: Record<string, any>) => beta());
  const create = vi.fn((_request: Record<string, any>) => plain());
  const client = { beta: { messages: { create: betaCreate } }, messages: { create } } as unknown as Anthropic;
  return { client, betaCreate, create };
}

const run = (client: Anthropic) => interpretWithClaude(facts, { apiKey: "k", model: "claude-opus-5-5", timeoutMs: 1000, client });

describe("interpretWithClaude", () => {
  it("sends the notebook's prompt, the facts, structured output and the refusal-fallback beta", async () => {
    const { client, betaCreate } = fakeClient(async () => message(goodText));
    const result = await run(client);
    expect(result.model).toBe("claude-opus-5-5");
    expect(result.interpretation.recommendations.length).toBeGreaterThan(0);
    const sent = betaCreate.mock.calls[0][0];
    expect(sent.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(sent.fallbacks).toBe("default");
    expect(sent.output_config.effort).toBe("low");
    expect(sent.output_config.format.type).toBe("json_schema");
    expect(sent.system).toContain("Use only numbers that appear in FACTS");
    expect(sent.messages[0].content).toContain(JSON.stringify(facts));
  });

  it("retries without the beta when the request is rejected as bad", async () => {
    const badRequest = new Anthropic.BadRequestError(400, { type: "error" }, "unknown parameter", new Headers());
    const { client, create } = fakeClient(async () => { throw badRequest; }, async () => message(goodText));
    await expect(run(client)).resolves.toBeTruthy();
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].betas).toBeUndefined();
  });

  it.each([
    ["refusal", message(null, "refusal"), "refused"],
    ["truncated", message("{\"partial\":", "max_tokens"), "truncated"],
    ["non-JSON text", message("Here is my analysis..."), "bad_output"],
    ["wrong JSON shape", message(JSON.stringify({ answer: "hi" })), "bad_output"],
  ])("turns a %s response into a %s error", async (_name, response, code) => {
    const { client } = fakeClient(async () => response);
    await expect(run(client)).rejects.toMatchObject({ code });
  });

  it("accepts JSON wrapped in a code fence", async () => {
    const { client } = fakeClient(async () => message("```json\n" + goodText + "\n```"));
    await expect(run(client)).resolves.toBeTruthy();
  });

  it.each([
    ["rate limit", () => new Anthropic.RateLimitError(429, { type: "error" }, "slow down", new Headers()), "rate_limited"],
    ["bad key", () => new Anthropic.AuthenticationError(401, { type: "error" }, "bad key", new Headers()), "auth"],
    ["timeout", () => new Anthropic.APIConnectionTimeoutError({ message: "timed out" }), "timeout"],
    ["network", () => new Anthropic.APIConnectionError({ message: "offline" }), "unavailable"],
    ["overloaded", () => new Anthropic.InternalServerError(529, { type: "error" }, "overloaded", new Headers()), "unavailable"],
  ])("maps %s errors to %s", async (_name, makeError, code) => {
    const { client } = fakeClient(async () => { throw makeError(); });
    const error = await run(client).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).code).toBe(code);
  });

  it("builds a request the API accepts in shape", () => {
    const request = buildRequest(facts, "claude-haiku-5-5");
    expect(request.model).toBe("claude-haiku-5-5");
    expect(request.max_tokens).toBe(16000);
    expect(Object.keys(request.output_config.format.schema)).toContain("properties");
  });
});
