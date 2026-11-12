/**
 * Cost and abuse controls for the LLM endpoint:
 *   - response cache keyed by a hash of (model, prompt, facts): identical questions are free;
 *   - per-IP limit: at most `perMinute` model calls per minute from one address (per instance);
 *   - daily cap on model calls across all users (persisted when a store is available).
 * Storage is Netlify Blobs when available, otherwise in-memory (resets on a cold start).
 */

export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    get: async (key) => map.get(key) ?? null,
    set: async (key, value) => {
      map.set(key, value);
    },
  };
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export type LimitDecision = { ok: true } | { ok: false; reason: "rate_limited" | "daily_cap"; retryAfterSeconds: number };

export interface Limits {
  getCached(key: string): Promise<string | null>;
  putCached(key: string, value: string): Promise<void>;
  admit(clientId: string, now: Date): Promise<LimitDecision>;
}

export function createLimits(store: KeyValueStore, options: { perMinute: number; dailyCap: number }): Limits {
  const recent = new Map<string, number[]>();      // client -> timestamps of model calls (last minute)

  return {
    getCached: async (key) => {
      try {
        return await store.get(`cache/${key}`);
      } catch {
        return null;                                 // a storage hiccup must never break the endpoint
      }
    },
    putCached: async (key, value) => {
      try {
        await store.set(`cache/${key}`, value);
      } catch {
        // caching is best effort
      }
    },
    admit: async (clientId, now) => {
      const t = now.getTime();
      const window = (recent.get(clientId) ?? []).filter((ts) => t - ts < 60_000);
      if (window.length >= options.perMinute) {
        recent.set(clientId, window);
        return { ok: false, reason: "rate_limited", retryAfterSeconds: Math.ceil((60_000 - (t - window[0])) / 1000) };
      }
      const dayKey = `daily/${now.toISOString().slice(0, 10)}`;
      let used = 0;
      try {
        used = Number((await store.get(dayKey)) ?? 0) || 0;
      } catch {
        used = 0;
      }
      if (used >= options.dailyCap) {
        const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
        return { ok: false, reason: "daily_cap", retryAfterSeconds: Math.ceil((midnight - t) / 1000) };
      }
      window.push(t);
      recent.set(clientId, window);
      try {
        await store.set(dayKey, String(used + 1));
      } catch {
        // counting is best effort
      }
      return { ok: true };
    },
  };
}
