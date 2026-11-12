import type { Analysis, Panel, ScenarioConfig } from "../data/types";
import type { EngineReadyInfo, WorkerRequest, WorkerResponse } from "./protocol";

export type EnginePhase = "idle" | "loading" | "ready" | "failed";

export interface EngineStatus {
  phase: EnginePhase;
  stage: string;
  fraction: number;
  info: EngineReadyInfo | null;
  error: string | null;
  restarts: number;
}

export class CancelledError extends Error {
  constructor() {
    super("Superseded by a newer request.");
    this.name = "CancelledError";
  }
}

interface Job {
  panel: Panel;
  config: ScenarioConfig;
  resolve: (value: { analysis: Analysis; ms: number }) => void;
  reject: (reason: Error) => void;
}

const MAX_RESTARTS = 2;
const RESTART_DELAYS_MS = [1000, 3000];

/**
 * Owns the engine Web Worker.
 * - Latest request wins: while one scenario computes, newer requests replace any queued one, so
 *   dragging a slider never builds a backlog.
 * - If the worker crashes it is restarted (twice, with back-off); after that the UI stays on the
 *   notebook snapshot.
 */
export class EngineClient {
  private worker: Worker | null = null;
  private readyPromise: Promise<EngineReadyInfo> | null = null;
  private readyResolve: ((info: EngineReadyInfo) => void) | null = null;
  private readyReject: ((error: Error) => void) | null = null;
  private running: { id: number; job: Job } | null = null;
  private queued: Job | null = null;
  private nextId = 1;
  private status: EngineStatus = { phase: "idle", stage: "", fraction: 0, info: null, error: null, restarts: 0 };
  private readonly engineUrl: string;
  private readonly onStatus: (status: EngineStatus) => void;
  private readonly createWorker: () => Worker;

  constructor(
    engineUrl: string,
    onStatus: (status: EngineStatus) => void,
    createWorker: () => Worker = () =>
      new Worker(new URL("./engine.worker.ts", import.meta.url), { type: "module", name: "forecast-engine" }),
  ) {
    this.engineUrl = engineUrl;
    this.onStatus = onStatus;
    this.createWorker = createWorker;
  }

  start(): Promise<EngineReadyInfo> {
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = new Promise<EngineReadyInfo>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    this.spawn();
    return this.readyPromise;
  }

  /** Compute one scenario; resolves with the parsed analysis or rejects (CancelledError if superseded). */
  run(panel: Panel, config: ScenarioConfig): Promise<{ analysis: Analysis; ms: number }> {
    return new Promise((resolve, reject) => {
      const job: Job = { panel, config, resolve, reject };
      if (this.status.phase === "failed") {
        reject(new Error(this.status.error ?? "The engine is unavailable."));
        return;
      }
      if (this.running) {
        this.queued?.reject(new CancelledError());
        this.queued = job;
        return;
      }
      this.dispatch(job);
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  private setStatus(patch: Partial<EngineStatus>): void {
    this.status = { ...this.status, ...patch };
    this.onStatus(this.status);
  }

  private spawn(): void {
    this.setStatus({ phase: "loading", stage: "Starting the engine", fraction: 0.02, error: null });
    const worker = this.createWorker();
    this.worker = worker;
    worker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => this.handle(event.data));
    worker.addEventListener("error", (event) => this.crash(event.message || "The engine worker crashed."));
    const init: WorkerRequest = { type: "init", engineUrl: this.engineUrl };
    worker.postMessage(init);
  }

  private dispatch(job: Job): void {
    const id = this.nextId++;
    this.running = { id, job };
    const request: WorkerRequest = {
      type: "run",
      id,
      panelJson: JSON.stringify(job.panel),
      configJson: JSON.stringify(job.config),
    };
    this.worker?.postMessage(request);
  }

  private finishRunning(): void {
    this.running = null;
    const next = this.queued;
    this.queued = null;
    if (next) this.dispatch(next);
  }

  private handle(message: WorkerResponse): void {
    switch (message.type) {
      case "progress":
        this.setStatus({ stage: message.stage, fraction: message.fraction });
        break;
      case "ready": {
        const { type: _ignored, ...info } = message;
        this.setStatus({ phase: "ready", stage: "Engine ready", fraction: 1, info, error: null });
        this.readyResolve?.(info);
        break;
      }
      case "result": {
        if (this.running?.id !== message.id) break;
        const { job } = this.running;
        try {
          job.resolve({ analysis: JSON.parse(message.json) as Analysis, ms: message.ms });
        } catch {
          job.reject(new Error("The engine returned invalid JSON."));
        }
        this.finishRunning();
        break;
      }
      case "error":
        if (message.fatal) {
          this.crash(message.message);
        } else if (this.running?.id === message.id) {
          this.running.job.reject(new Error(message.message));
          this.finishRunning();
        }
        break;
    }
  }

  private crash(reason: string): void {
    this.worker?.terminate();
    this.worker = null;
    const inFlight = [this.running?.job, this.queued].filter((j): j is Job => Boolean(j));
    this.running = null;
    this.queued = null;
    inFlight.forEach((job) => job.reject(new Error(reason)));

    if (this.status.restarts < MAX_RESTARTS && this.status.phase !== "failed") {
      const delay = RESTART_DELAYS_MS[this.status.restarts] ?? 3000;
      this.setStatus({ phase: "loading", stage: `Engine restarting after an error (${reason})`, restarts: this.status.restarts + 1 });
      setTimeout(() => this.spawn(), delay);
      return;
    }
    this.setStatus({ phase: "failed", stage: "Engine unavailable", error: reason, fraction: 0 });
    this.readyReject?.(new Error(reason));
  }
}
