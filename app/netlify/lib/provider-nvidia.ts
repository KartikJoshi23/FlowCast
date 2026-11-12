/**
 * NVIDIA API Catalog (build.nvidia.com) provider: free API key, OpenAI-compatible endpoint.
 *
 * - Same prompt and JSON schema as the Claude provider (from the notebook's `prompt` cell).
 * - Asks the endpoint for schema-guided JSON (`nvext.guided_json`); if a model rejects that
 *   option, the request is retried once without it and the prompt alone asks for JSON.
 * - If a model is retired or unknown (HTTP 404/410), the next model in the list is tried.
 * - Every failure becomes a ProviderError, so the dashboard falls back to the rule-based text.
 */
import type { Facts } from "./facts-validation";
import { parseInterpretation } from "./interpretation";
import prompt from "./interpretation-prompt.json";
import { ProviderError, type ProviderResult } from "./provider-anthropic";

export const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
/**
 * Tried in order: NVIDIA retires catalog models (HTTP 404/410), so the next one is used automatically.
 * LLM_MODEL may override this with one model or a comma-separated list.
 */
export const NVIDIA_DEFAULT_MODELS = [
  "deepseek-ai/deepseek-v4.1-flash",
  "nvidia/nemotron-3-super-120b-a12b",
  "z-ai/glm-5.3-flash",
  "openai/gpt-oss-20b",
];
export const NVIDIA_DEFAULT_MODEL = NVIDIA_DEFAULT_MODELS.join(",");

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

  const models = options.model.split(",").map((m) => m.trim()).filter(Boolean);
  const send = async (model: string, guided: boolean) => {
    try {
      return await doFetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${options.apiKey}`, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(buildNvidiaRequest(facts, model, guided)),
        signal: deadline,
      });
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        throw new ProviderError("timeout", "The LLM did not answer in time.");
      }
      throw new ProviderError("unavailable", "The LLM API could not be reached.");
    }
  };

  let response: Response | null = null;
  let usedModel = models[0] ?? "";
  for (const model of models) {
    usedModel = model;
    response = await send(model, true);
    if (response.status === 400 || response.status === 422) response = await send(model, false);   // model without guided JSON
    if (response.status !== 404 && response.status !== 410) break;                                 // retired model: try the next
  }
  if (!response) throw new ProviderError("not_configured", "No LLM model is configured.");
  if (response.status === 404 || response.status === 410) {
    throw new ProviderError("unavailable", `None of the configured NVIDIA models is available any more (${models.join(", ")}).`);
  }

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
  return { interpretation, model: data.model ?? usedModel };
}
