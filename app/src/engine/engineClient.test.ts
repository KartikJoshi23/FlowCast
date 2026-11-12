import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Panel, ScenarioConfig } from "../data/types";
import { CancelledError, EngineClient, type EngineStatus } from "./engineClient";
import type { WorkerRequest, WorkerResponse } from "./protocol";

/** In-memory stand-in for the Pyodide worker. */
class FakeWorker {
  sent: WorkerRequest[] = [];
  private listeners: Record<string, ((event: unknown) => void)[]> = {};
  terminated = false;
  addEventListener(type: string, listener: (event: unknown) => void) {
    (this.listeners[type] ??= []).push(listener);
  }
  postMessage(message: WorkerRequest) {
    this.sent.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  emit(message: WorkerResponse) {
    this.listeners.message?.forEach((l) => l({ data: message }));
  }
  crash(text: string) {
    this.listeners.error?.forEach((l) => l({ message: text }));
  }
}

const panel = { months: ["2022-08"], series: {} } as unknown as Panel;
const config: ScenarioConfig = { level: "total", test_size: 3, horizon: 3, arima_order: null };
const ready: WorkerResponse = { type: "ready", pyodideVersion: "314.0.7", engineVersion: "1.0.0", engineSha256: "abc", libraries: {}, loadMs: 10 };
const result = (id: number) => ({ type: "result", id, json: JSON.stringify({ result: { id } }), ms: 5 }) as WorkerResponse;

describe("EngineClient", () => {
  let workers: FakeWorker[];
  let statuses: EngineStatus[];
  let client: EngineClient;

  beforeEach(() => {
    vi.useFakeTimers();
    workers = [];
    statuses = [];
    client = new EngineClient("/engine.py", (s) => statuses.push(s), () => {
      const w = new FakeWorker();
      workers.push(w);
      return w as unknown as Worker;
    });
  });
  afterEach(() => vi.useRealTimers());

  it("initialises the worker and reports readiness", async () => {
    const started = client.start();
    expect(workers[0].sent[0]).toEqual({ type: "init", engineUrl: "/engine.py" });
    workers[0].emit(ready);
    await expect(started).resolves.toMatchObject({ engineSha256: "abc" });
    expect(statuses.at(-1)?.phase).toBe("ready");
  });

  it("lets the latest request win while a scenario is computing", async () => {
    void client.start();
    workers[0].emit(ready);
    const first = client.run(panel, config);
    const superseded = client.run(panel, { ...config, horizon: 2 });
    const latest = client.run(panel, { ...config, horizon: 1 });
    await expect(superseded).rejects.toBeInstanceOf(CancelledError);
    expect(workers[0].sent.filter((m) => m.type === "run")).toHaveLength(1);   // only the first was dispatched
    workers[0].emit(result(1));
    await expect(first).resolves.toMatchObject({ ms: 5 });
    const runs = workers[0].sent.filter((m) => m.type === "run");
    expect(runs).toHaveLength(2);
    expect(JSON.parse((runs[1] as { configJson: string }).configJson).horizon).toBe(1);
    workers[0].emit(result(2));
    await expect(latest).resolves.toBeTruthy();
  });

  it("rejects a run when the engine reports a non-fatal error", async () => {
    void client.start();
    workers[0].emit(ready);
    const run = client.run(panel, config);
    workers[0].emit({ type: "error", id: 1, message: "ValueError: bad level", fatal: false });
    await expect(run).rejects.toThrow("bad level");
  });

  it("restarts after a crash, then gives up after two restarts", async () => {
    const started = client.start();
    started.catch(() => undefined);
    workers[0].crash("out of memory");
    expect(statuses.at(-1)?.phase).toBe("loading");
    vi.advanceTimersByTime(1000);
    expect(workers).toHaveLength(2);
    workers[1].crash("out of memory");
    vi.advanceTimersByTime(3000);
    expect(workers).toHaveLength(3);
    workers[2].crash("out of memory");
    expect(statuses.at(-1)?.phase).toBe("failed");
    await expect(started).rejects.toThrow("out of memory");
    await expect(client.run(panel, config)).rejects.toThrow("out of memory");
  });
});
