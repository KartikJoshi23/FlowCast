/**
 * Netlify Function: POST /api/interpret
 *
 * The only place the LLM API key exists. It is read from an environment variable (set in Netlify
 * as a secret, scoped to Functions) and never sent to the browser:
 *   NVIDIA_API_KEY     free key from build.nvidia.com (used first if set; default model meta/llama-3.3-70b-instruct)
 *   ANTHROPIC_API_KEY  Claude (default model claude-opus-5-5)
 * Optional: LLM_MODEL (override the model), LLM_DAILY_CAP (default 200), LLM_PER_MINUTE (default 6).
 */
import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import { handleInterpret } from "../lib/handler";
import { createLimits, memoryStore, sha256Hex, type KeyValueStore } from "../lib/limits";
import prompt from "../lib/interpretation-prompt.json";
import { DEFAULT_MODEL, interpretWithClaude } from "../lib/provider-anthropic";
import { interpretWithNvidia, NVIDIA_DEFAULT_MODEL } from "../lib/provider-nvidia";

const fallbackStore = memoryStore();

/** Netlify Blobs when available (deployed or `netlify dev`), otherwise per-instance memory. */
function openStore(): KeyValueStore {
  try {
    const blobs = getStore({ name: "flowcast-llm", consistency: "strong" });
    return {
      get: (key) => blobs.get(key, { type: "text" }),
      set: async (key, value) => {
        await blobs.set(key, value);
      },
    };
  } catch {
    return fallbackStore;
  }
}

const positiveInt = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

let promptVersion: Promise<string> | null = null;

export default async (request: Request, context: Context) => {
  const nvidiaKey = process.env.NVIDIA_API_KEY?.trim();
  const provider = nvidiaKey ? "nvidia" : "anthropic";
  const apiKey = nvidiaKey || process.env.ANTHROPIC_API_KEY?.trim();
  const model = process.env.LLM_MODEL?.trim() || (provider === "nvidia" ? NVIDIA_DEFAULT_MODEL : DEFAULT_MODEL);
  promptVersion ??= sha256Hex(JSON.stringify(prompt));
  const limits = createLimits(openStore(), {
    perMinute: positiveInt(process.env.LLM_PER_MINUTE, 6),
    dailyCap: positiveInt(process.env.LLM_DAILY_CAP, 200),
  });
  return handleInterpret(request, context.ip, {
    apiKey,
    provider,
    model,
    promptVersion: await promptVersion,
    limits,
    now: () => new Date(),
    callModel: (facts) => provider === "nvidia"
      ? interpretWithNvidia(facts, { apiKey: apiKey ?? "", model, timeoutMs: 40_000 })
      : interpretWithClaude(facts, { apiKey: apiKey ?? "", model, timeoutMs: 40_000 }),
  });
};

export const config: Config = {
  path: "/api/interpret",
};
