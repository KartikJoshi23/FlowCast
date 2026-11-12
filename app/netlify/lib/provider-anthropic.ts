/**
 * Claude (Anthropic API) provider for the interpretation.
 *
 * - Prompt and JSON schema come from the notebook's `prompt` cell (interpretation-prompt.json),
 *   so the dashboard and the notebook ask the model exactly the same thing.
 * - Structured output (JSON schema) guarantees the answer's shape; effort "low" keeps latency down
 *   for an explanation task; the API's server-side refusal fallback is enabled (if that beta option
 *   is rejected, the request is retried once without it).
 * - Every failure becomes a ProviderError with a code the UI can explain.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { Facts } from "./facts-validation";
import type { Interpretation } from "./grounding";
import { parseInterpretation } from "./interpretation";
import prompt from "./interpretation-prompt.json";

export const DEFAULT_MODEL = "claude-opus-5-5";

export type ProviderErrorCode = "not_configured" | "auth" | "rate_limited" | "timeout" | "refused" | "truncated" | "bad_output" | "unavailable";

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  constructor(code: ProviderErrorCode, message: string) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
  }
}

export interface ProviderResult {
  interpretation: Interpretation;
  model: string;
}

type MessagesClient = Pick<Anthropic, "messages" | "beta">;

export function buildRequest(facts: Facts, model: string) {
  return {
    model,
    max_tokens: 16000,
    system: prompt.system_prompt,
    messages: [{ role: "user" as const, content: prompt.user_template.replace("{facts_json}", JSON.stringify(facts)) }],
    output_config: {
      effort: "low" as const,
      format: { type: "json_schema" as const, schema: prompt.output_schema as Record<string, unknown> },
    },
  };
}

export async function interpretWithClaude(
  facts: Facts,
  options: { apiKey: string; model: string; timeoutMs: number; client?: MessagesClient },
): Promise<ProviderResult> {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey, timeout: options.timeoutMs, maxRetries: 1 });
  const request = buildRequest(facts, options.model);

  let response: { stop_reason: string | null; model: string; content: { type: string; text?: string }[] };
  try {
    try {
      response = await client.beta.messages.create({
        ...request,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
    } catch (error) {
      if (!(error instanceof Anthropic.BadRequestError)) throw error;
      response = await client.messages.create(request);      // retry without the refusal-fallback beta
    }
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      throw new ProviderError("auth", "The LLM API key was rejected.");
    }
    if (error instanceof Anthropic.RateLimitError) throw new ProviderError("rate_limited", "The LLM API is rate-limiting requests.");
    if (error instanceof Anthropic.APIConnectionTimeoutError) throw new ProviderError("timeout", "The LLM did not answer in time.");
    if (error instanceof Anthropic.APIConnectionError) throw new ProviderError("unavailable", "The LLM API could not be reached.");
    if (error instanceof Anthropic.APIError) throw new ProviderError("unavailable", `The LLM API returned an error (HTTP ${error.status ?? "?"}).`);
    throw new ProviderError("unavailable", "The LLM request failed.");
  }

  if (response.stop_reason === "refusal") throw new ProviderError("refused", "The model declined to answer.");
  if (response.stop_reason === "max_tokens") throw new ProviderError("truncated", "The model's answer was cut off.");
  const text = response.content.find((b) => b.type === "text")?.text;
  const interpretation = text ? parseInterpretation(text) : null;
  if (!interpretation) throw new ProviderError("bad_output", "The model's answer was not in the expected format.");
  return { interpretation, model: response.model };
}
