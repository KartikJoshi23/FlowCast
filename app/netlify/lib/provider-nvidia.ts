/**
 * NVIDIA API Catalog (build.nvidia.com) provider: free API key, OpenAI-compatible endpoint.
 *
 * - Same prompt and JSON schema as the Claude provider (from the notebook's `prompt` cell).
 * - Asks the model to skip its slow thinking phase; if a model rejects that option the request is
 *   retried once without it. The prompt carries the JSON schema and the server validates the answer.
 * - The answer is streamed, so a failure can say whether the model sent nothing or was just slow.
 * - Free endpoints queue unpredictably, so in "parallel" mode (the background function) all models
 *   are asked at once; the first fully grounded answer wins (or, after a grace period, the answer with
 *   the fewest grounding problems) and the others are cancelled. In sequential mode
 *   (short request function) the models are tried in order within the deadline.
 * - Retired models (HTTP 404/410) are skipped. Every failure becomes a ProviderError, so the
 *   dashboard falls back to the rule-based text.
 */
import type { Facts } from "./facts-validation";
import { parseInterpretation } from "./interpretation";
import prompt from "./interpretation-prompt.json";
import { ProviderError, type ProviderResult } from "./provider-anthropic";

export const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
/** Default models (LLM_MODEL may override with one model or a comma-separated list). */
export const NVIDIA_DEFAULT_MODELS = [
  "openai/gpt-oss-20b",
  "deepseek-ai/deepseek-v4.1-flash",
  "z-ai/glm-5.3-flash",
  "nvidia/nemotron-3.5-lightning-30b-a3b",
  "nvidia/nemotron-3-super-120b-a12b",
];
export const NVIDIA_DEFAULT_MODEL = NVIDIA_DEFAULT_MODELS.join(",");

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/**
 * "fast" asks the model to skip its slow thinking phase (reasoning_effort for gpt-oss, the chat-template
 * switch for DeepSeek/GLM/Nemotron); "plain" is the bare OpenAI-compatible request, used if a model
 * rejects those options.
 */
export type RequestVariant = "fast" | "plain";

/** Every leaf path in FACTS as a dotted key (list positions as numbers), as the grounding check reads them. */
export function factPaths(facts: unknown): string[] {
  const out: string[] = [];
  const walk = (node: unknown, path: string) => {
    if (node && typeof node === "object") {
      const entries: [string, unknown][] = Array.isArray(node) ? node.map((v, i) => [String(i), v]) : Object.entries(node);
      if (entries.length === 0 && path) out.push(path);
      for (const [key, value] of entries) walk(value, path ? `${path}.${key}` : key);
    } else if (path) {
      out.push(path);
    }
  };
  walk(facts, "");
  return out;
}

export function buildNvidiaRequest(facts: Facts, model: string, variant: RequestVariant) {
  // Open models tend to guess evidence paths, so they get the exact list the grounding check accepts.
  const schemaHint = `\n\nReturn only a JSON object (no prose, no code fence) matching this JSON schema:\n${JSON.stringify(prompt.output_schema)}` +
    `\n\nValid evidence keys (copy them exactly; cite only keys from this list):\n${factPaths(facts).join(", ")}`;
  return {
    model,
    temperature: 0.2,
    top_p: 0.9,
    max_tokens: 3000,
    stream: true,
    messages: [
      { role: "system", content: prompt.system_prompt },
      { role: "user", content: prompt.user_template.replace("{facts_json}", JSON.stringify(facts)) + schemaHint },
    ],
    ...(variant === "fast"
      ? model.startsWith("openai/gpt-oss")
        ? { reasoning_effort: "low" }
        : { chat_template_kwargs: { thinking: false, enable_thinking: false } }
      : {}),
  };
}

export interface NvidiaOptions {
  apiKey: string;
  model: string;
  timeoutMs: number;
  perModelMs?: number;
  parallel?: boolean;
  /** Parallel mode: problems in an answer (0 = fully grounded). A flawed first answer waits for a better one. */
  score?: (interpretation: ProviderResult["interpretation"]) => number;
  /** How long to keep waiting for a better answer after the first flawed one (default 45 s). */
  graceMs?: number;
  fetchImpl?: FetchLike;
  baseUrl?: string;
}

interface Progress {
  firstByteMs: number | null;
  chars: number;
}

type Completion = { model?: string; text: string; finishReason: string | null };

const shortName = (model: string) => model.split("/").pop() ?? model;
const isAbort = (error: unknown) => error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");

/** Read an OpenAI-style answer: a server-sent event stream, or a plain JSON body. */
async function readCompletion(response: Response, progress: Progress, started: number): Promise<Completion> {
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("text/event-stream") || !response.body) {
    const data = (await response.json()) as { model?: string; choices?: { finish_reason?: string | null; message?: { content?: string | null } }[] };
    const choice = data.choices?.[0];
    const text = choice?.message?.content ?? "";
    progress.firstByteMs ??= Date.now() - started;
    progress.chars = text.length;
    return { model: data.model, text, finishReason: choice?.finish_reason ?? null };
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let text = "";
  let model: string | undefined;
  let finishReason: string | null = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    progress.firstByteMs ??= Date.now() - started;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const payload = line.startsWith("data:") ? line.slice(5).trim() : "";
      if (!payload || payload === "[DONE]") continue;
      try {
        const chunk = JSON.parse(payload) as {
          model?: string;
          choices?: { finish_reason?: string | null; delta?: { content?: string | null; reasoning_content?: string | null } }[];
        };
        model ??= chunk.model;
        const choice = chunk.choices?.[0];
        const piece = choice?.delta?.content ?? "";
        text += piece;
        progress.chars += piece.length + (choice?.delta?.reasoning_content?.length ?? 0);
        if (choice?.finish_reason) finishReason = choice.finish_reason;
      } catch {
        // ignore keep-alive or partial lines
      }
    }
  }
  return { model, text, finishReason };
}

export async function interpretWithNvidia(facts: Facts, options: NvidiaOptions): Promise<ProviderResult> {
  const doFetch: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const url = `${options.baseUrl ?? NVIDIA_BASE_URL}/chat/completions`;
  const deadline = AbortSignal.timeout(options.timeoutMs);
  const perModelMs = options.perModelMs ?? options.timeoutMs;
  const models = options.model.split(",").map((m) => m.trim()).filter(Boolean);
  if (models.length === 0) throw new ProviderError("not_configured", "No LLM model is configured.");

  /** One model; throws a ProviderError whose message names the model and what happened. */
  const attempt = async (model: string, cancel: AbortSignal): Promise<ProviderResult> => {
    const signal = AbortSignal.any([deadline, cancel, AbortSignal.timeout(perModelMs)]);
    const started = Date.now();
    const progress: Progress = { firstByteMs: null, chars: 0 };
    const secs = () => ((Date.now() - started) / 1000).toFixed(1);
    const timedOut = () => {
      const what = progress.firstByteMs === null
        ? "no reply"
        : `still writing (first output at ${(progress.firstByteMs / 1000).toFixed(1)} s, ${progress.chars} characters)`;
      return new ProviderError("timeout", `${shortName(model)}: ${what} after ${secs()} s`);
    };
    const send = async (variant: RequestVariant) => {
      try {
        return await doFetch(url, {
          method: "POST",
          headers: { authorization: `Bearer ${options.apiKey}`, "content-type": "application/json", accept: "text/event-stream, application/json" },
          body: JSON.stringify(buildNvidiaRequest(facts, model, variant)),
          signal,
        });
      } catch (error) {
        if (isAbort(error)) throw timedOut();
        throw new ProviderError("unavailable", `${shortName(model)}: API could not be reached`);
      }
    };

    let response = await send("fast");
    if (response.status === 400 || response.status === 422) response = await send("plain");   // model rejects the speed options
    if (response.status === 401 || response.status === 403) throw new ProviderError("auth", "The LLM API key was rejected.");
    if (response.status === 429) throw new ProviderError("rate_limited", `${shortName(model)}: rate limited (HTTP 429)`);
    if (response.status === 404 || response.status === 410) throw new ProviderError("unavailable", `${shortName(model)}: model retired (HTTP ${response.status})`);
    if (!response.ok) throw new ProviderError("unavailable", `${shortName(model)}: HTTP ${response.status}`);

    let completion: Completion;
    try {
      completion = await readCompletion(response, progress, started);
    } catch (error) {
      if (isAbort(error) || signal.aborted) throw timedOut();
      throw new ProviderError("bad_output", `${shortName(model)}: unreadable answer`);
    }
    if (completion.finishReason === "length") throw new ProviderError("truncated", `${shortName(model)}: answer cut off`);
    const interpretation = completion.text ? parseInterpretation(completion.text) : null;
    if (!interpretation) throw new ProviderError("bad_output", `${shortName(model)}: answer not in the expected JSON format`);
    return { interpretation, model: completion.model ?? model };
  };

  const summarise = (errors: ProviderError[]): ProviderError => {
    if (errors.some((e) => e.code === "auth")) return new ProviderError("auth", "The LLM API key was rejected.");
    const detail = errors.map((e) => e.message).join("; ");
    const code = errors.every((e) => e.code === "timeout") || deadline.aborted ? "timeout"
      : errors.every((e) => e.code === "rate_limited") ? "rate_limited"
      : (errors.at(-1)?.code ?? "unavailable");
    const lead = code === "timeout" ? "The LLM did not answer in time" : code === "rate_limited" ? "The LLM API is rate-limiting requests" : "The LLM request failed";
    return new ProviderError(code, `${lead} (${detail}).`);
  };
  const asProviderError = (error: unknown) =>
    error instanceof ProviderError ? error : new ProviderError("unavailable", "The LLM request failed.");

  if (options.parallel && models.length > 1) {
    // Ask every model at once. The first fully grounded answer wins; if the first answer has
    // problems, keep waiting (graceMs) for a better one, then take the answer with the fewest.
    const controller = new AbortController();
    const errors: ProviderError[] = [];
    let best: { result: ProviderResult; score: number } | null = null;
    await new Promise<void>((resolve) => {
      let open = models.length;
      let grace: ReturnType<typeof setTimeout> | undefined;
      const finish = () => {
        clearTimeout(grace);
        resolve();
      };
      for (const model of models) {
        attempt(model, controller.signal)
          .then((result) => {
            const score = options.score ? options.score(result.interpretation) : 0;
            if (!best || score < best.score) best = { result, score };
            if (score === 0) finish();
            else grace ??= setTimeout(finish, options.graceMs ?? 45_000);
          }, (error: unknown) => {
            errors.push(asProviderError(error));
          })
          .finally(() => {
            open -= 1;
            if (open === 0) finish();
          });
      }
    });
    controller.abort();
    const winner = best as { result: ProviderResult; score: number } | null;
    if (winner) return winner.result;
    throw summarise(errors);
  }

  // Sequential: a rejected key stops at once; anything else moves on to the next model.
  const errors: ProviderError[] = [];
  const never = new AbortController().signal;
  for (const model of models) {
    if (deadline.aborted) break;
    try {
      return await attempt(model, never);
    } catch (error) {
      const failure = asProviderError(error);
      if (failure.code === "auth") throw new ProviderError("auth", "The LLM API key was rejected.");
      if (failure.code === "rate_limited") throw new ProviderError("rate_limited", "The LLM API is rate-limiting requests.");
      errors.push(failure);
    }
  }
  throw summarise(errors.length ? errors : [new ProviderError("timeout", "no model was tried")]);
}
