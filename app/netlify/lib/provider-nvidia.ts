/**
 * NVIDIA API Catalog (build.nvidia.com) provider: free API key, OpenAI-compatible endpoint.
 *
 * - Same prompt and JSON schema as the Claude provider (from the notebook's `prompt` cell).
 * - Asks the endpoint for schema-guided JSON (`nvext.guided_json`); if a model rejects that
 *   option, the request is retried once without it and the prompt alone asks for JSON.
 * - Every failure becomes a ProviderError, so the dashboard falls back to the rule-based text.
 */
import type { Facts } from "./facts-validation";
import { parseInterpretation } from "./interpretation";
import prompt from "./interpretation-prompt.json";
import { ProviderError, type ProviderResult } from "./provider-anthropic";

export const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
export const NVIDIA_DEFAULT_MODEL = "meta/llama-3.3-70b-instruct";

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export function buildNvidiaRequest(facts: Facts, model: string, guided: boolean) {
  const schemaHint = `\n\nReturn only a JSON object (no prose, no code fence) matching this JSON schema:\n${JSON.stringify(prompt.output_schema)}`;
  return {
    model,
    temperature: 0.2,
    top_p: 0.9,
    max_tokens: 2048,
    stream: false,
    messages: [
      { role: "system", content: prompt.system_prompt },
      { role: "user", content: prompt.user_template.replace("{facts_json}", JSON.stringify(facts)) + schemaHint },
    ],
    ...(guided ? { nvext: { guided_json: prompt.output_schema } } : {}),
  };
}

export async function interpretWithNvidia(
  facts: Facts,
  options: { apiKey: string; model: string; timeoutMs: number; fetchImpl?: FetchLike; baseUrl?: string },
): Promise<ProviderResult> {
  const doFetch: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const url = `${options.baseUrl ?? NVIDIA_BASE_URL}/chat/completions`;
  const deadline = AbortSignal.timeout(options.timeoutMs);

  const send = async (guided: boolean) => {
    try {
      return await doFetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${options.apiKey}`, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(buildNvidiaRequest(facts, options.model, guided)),
        signal: deadline,
      });
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        throw new ProviderError("timeout", "The LLM did not answer in time.");
      }
      throw new ProviderError("unavailable", "The LLM API could not be reached.");
    }
  };

  let response = await send(true);
  if (response.status === 400 || response.status === 422) response = await send(false);   // model without guided JSON

  if (response.status === 401 || response.status === 403) throw new ProviderError("auth", "The LLM API key was rejected.");
  if (response.status === 429) throw new ProviderError("rate_limited", "The LLM API is rate-limiting requests.");
  if (!response.ok) throw new ProviderError("unavailable", `The LLM API returned an error (HTTP ${response.status}).`);

  let data: { model?: string; choices?: { finish_reason?: string | null; message?: { content?: string | null } }[] };
  try {
    data = await response.json();
  } catch {
    throw new ProviderError("bad_output", "The model's answer was not in the expected format.");
  }
  const choice = data.choices?.[0];
  if (choice?.finish_reason === "length") throw new ProviderError("truncated", "The model's answer was cut off.");
  const text = choice?.message?.content;
  const interpretation = text ? parseInterpretation(text) : null;
  if (!interpretation) throw new ProviderError("bad_output", "The model's answer was not in the expected format.");
  return { interpretation, model: data.model ?? options.model };
}
