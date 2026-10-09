import { jobRegistry } from "./jobRegistry.ts";

type QueuePriority = "high" | "default" | "low";

/** Transport identity is stable across automatic recovery, not manual failed-job replay. */
interface JobContext {
  readonly jobId: string;
  readonly signal: AbortSignal;
}

abstract class Job<TPayload extends object = object> {
  static readonly jobName?: string;
  readonly maxAttempts?: number;
  readonly backoffMs?: number;
  readonly priority?: QueuePriority;

  constructor() {
    const jobName = (this.constructor as typeof Job).jobName;
    if (jobName) {
      jobRegistry.track(jobName, this);
    }
  }

  abstract handle(payload: TPayload, context?: JobContext): Promise<void>;
}

interface Queue {
  close?(): void | Promise<void>;
  dispatch<TPayload extends object>(job: Job<TPayload>, payload: TPayload): Promise<void>;
}

class SyncQueue implements Queue {
  async dispatch<TPayload extends object>(job: Job<TPayload>, payload: TPayload): Promise<void> {
    await job.handle(payload);
  }
}

class AsyncQueue implements Queue {
  private readonly active = new Set<Promise<void>>();
  private closing?: Promise<void>;
  private closed = false;

  protected assertOpen(): void {
    if (this.closed) throw new Error("Async queue is closed.");
  }

  protected enqueue(task: () => Promise<void>, onError: (error: unknown) => void): void {
    this.assertOpen();
    const running = new Promise<void>((resolve) => {
      setTimeout(() => {
        void Promise.resolve().then(task).catch(onError).finally(resolve);
      }, 0);
    });
    this.active.add(running);
    void running.then(() => {
      this.active.delete(running);
    });
  }

  async dispatch<TPayload extends object>(job: Job<TPayload>, payload: TPayload): Promise<void> {
    this.enqueue(
      () => job.handle(payload),
      (error) => {
        console.error("[AsyncQueue] Job failed:", error);
      },
    );
  }

  close(): Promise<void> {
    this.closing ??= (async () => {
      // Producers must be quiescent first. Admitted jobs may enqueue child jobs.
      while (this.active.size) await Promise.all([...this.active]);
      this.closed = true;
    })();
    return this.closing;
  }
}

function createQueue(driver: "sync" | "async"): Queue {
  return driver === "async" ? new AsyncQueue() : new SyncQueue();
}

export type { JobContext, Queue, QueuePriority };
export { AsyncQueue, createQueue, Job, SyncQueue };
