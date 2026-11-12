/**
 * Netlify Function: POST /api/interpret
 *
 * The only place the LLM API key exists. It is read from the ANTHROPIC_API_KEY environment
 * variable (set in Netlify as a secret, scoped to Functions) and never sent to the browser.
 * Optional: LLM_MODEL (default claude-opus-5-5), LLM_DAILY_CAP (default 200), LLM_PER_MINUTE (default 6).
 */
import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import { handleInterpret } from "../lib/handler";
import { createLimits, memoryStore, sha256Hex, type KeyValueStore } from "../lib/limits";
import prompt from "../lib/interpretation-prompt.json";
import { DEFAULT_MODEL, interpretWithClaude } from "../lib/provider-anthropic";

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
  const model = process.env.LLM_MODEL?.trim() || DEFAULT_MODEL;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  promptVersion ??= sha256Hex(JSON.stringify(prompt));
  const limits = createLimits(openStore(), {
    perMinute: positiveInt(process.env.LLM_PER_MINUTE, 6),
    dailyCap: positiveInt(process.env.LLM_DAILY_CAP, 200),
  });
  return handleInterpret(request, context.ip, {
    apiKey,
    model,
    promptVersion: await promptVersion,
    limits,
    now: () => new Date(),
    callModel: (facts) => interpretWithClaude(facts, { apiKey: apiKey ?? "", model, timeoutMs: 40_000 }),
  });
};

export const config: Config = {
  path: "/api/interpret",
};
