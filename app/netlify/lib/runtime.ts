/**
 * Builds the handler's dependencies from the environment. Shared by the request function
 * (interpret.mts) and the background function (interpret-run.mts).
 *
 * The LLM API key exists only here, read from an environment variable (set in Netlify as a secret,
 * scoped to Functions) and never sent to the browser:
 *   NVIDIA_API_KEY     free key from build.nvidia.com (used first if set; models in provider-nvidia.ts)
 *   ANTHROPIC_API_KEY  Claude (default model claude-opus-5-5)
 * Optional: LLM_MODEL (override; for NVIDIA a comma-separated list is allowed), LLM_DAILY_CAP (200),
 * LLM_PER_MINUTE (6).
 */
import { getStore } from "@netlify/blobs";
import type { HandlerDeps, JobRunner } from "./handler";
import prompt from "./interpretation-prompt.json";
import { createLimits, memoryStore, sha256Hex, type KeyValueStore } from "./limits";
import { DEFAULT_MODEL, interpretWithClaude } from "./provider-anthropic";
import { interpretWithNvidia, NVIDIA_DEFAULT_MODEL } from "./provider-nvidia";

export const RUN_PATH = "/api/interpret-run";
const fallbackStore = memoryStore();

/** Netlify Blobs when available (deployed or `netlify dev`), otherwise null. */
function openBlobs(): KeyValueStore | null {
  try {
    const blobs = getStore({ name: "flowcast-llm", consistency: "strong" });
    return {
      get: (key) => blobs.get(key, { type: "text" }),
      set: async (key, value) => {
        await blobs.set(key, value);
      },
    };
  } catch {
    return null;
  }
}

const positiveInt = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

let promptVersion: Promise<string> | null = null;

/**
 * mode "request": the short-lived request function. It hands the model call to the background
 * function when Blobs are available; otherwise it calls the model itself within ~25 s.
 * mode "background": the background function (up to 15 min), so generous model time limits.
 */
export async function buildDeps(mode: "request" | "background", requestUrl: string): Promise<HandlerDeps> {
  const nvidiaKey = process.env.NVIDIA_API_KEY?.trim();
  const provider = nvidiaKey ? "nvidia" : "anthropic";
  const apiKey = nvidiaKey || process.env.ANTHROPIC_API_KEY?.trim() || undefined;
  const model = process.env.LLM_MODEL?.trim() || (provider === "nvidia" ? NVIDIA_DEFAULT_MODEL : DEFAULT_MODEL);
  promptVersion ??= sha256Hex(JSON.stringify(prompt));

  const blobs = openBlobs();
  const store = blobs ?? fallbackStore;
  const limits = createLimits(store, {
    perMinute: positiveInt(process.env.LLM_PER_MINUTE, 6),
    dailyCap: positiveInt(process.env.LLM_DAILY_CAP, 200),
  });

  const timeoutMs = mode === "background" ? 150_000 : 25_000;
  const perModelMs = mode === "background" ? 75_000 : 14_000;

  const jobs: JobRunner | undefined = blobs && apiKey
    ? {
        store: blobs,
        secret: apiKey,
        start: async (body) => {
          const response = await fetch(new URL(RUN_PATH, requestUrl), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(8_000),
          });
          return response.status === 202 || response.ok;
        },
      }
    : undefined;

  return {
    apiKey,
    provider,
    model,
    promptVersion: await promptVersion,
    limits,
    now: () => new Date(),
    jobs,
    callModel: (facts) => provider === "nvidia"
      ? interpretWithNvidia(facts, { apiKey: apiKey ?? "", model, timeoutMs, perModelMs })
      : interpretWithClaude(facts, { apiKey: apiKey ?? "", model, timeoutMs }),
  };
}
