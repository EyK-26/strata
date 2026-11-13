type QueuePriority = "high" | "default" | "low";

/** Logical identity is stable across automatic recovery and supported manual replay. */
interface JobContext {
  /** Verified execution identity and owned policy supplied by application queue services. */
  readonly actor?: import("../contracts/application").ExecutionActor;
  readonly tenant?: import("../contracts/application").ApplicationConfig;
  readonly policy?: import("../contracts/persistence").ScopedPolicy;
  /** One-based execution attempt supplied by the framework retry owner. */
  readonly auditExport?: () => Promise<number>;
  readonly cache?: import("../../types/services").CacheLike;
  readonly database?: import("../database/session").DatabaseSession;
  readonly attempt?: number;
  readonly jobId: string;
  readonly signal: AbortSignal;
  readonly deadlineAtMs?: number;
}

abstract class Job<TPayload extends object = object> {
  static readonly jobName?: string;
  readonly maxAttempts?: number;
  readonly backoffMs?: number;
  readonly priority?: QueuePriority;

  abstract handle(payload: TPayload, context?: JobContext): Promise<void>;
}

interface QueueDispatchOptions {
  /** Opaque authenticated identity snapshot created by application composition. */
  readonly handoff?: string;
}

interface Queue {
  close?(): void | Promise<void>;
  /** Preserve a stored logical identity on deliberate replay; reset execution controls. */
  replay?<TPayload extends object>(
    job: Job<TPayload>,
    payload: TPayload,
    jobId: string,
    options?: QueueDispatchOptions,
  ): Promise<void>;
  dispatch<TPayload extends object>(
    job: Job<TPayload>,
    payload: TPayload,
    options?: QueueDispatchOptions,
  ): Promise<void>;
}

class SyncQueue implements Queue {
  async dispatch<TPayload extends object>(
    job: Job<TPayload>,
    payload: TPayload,
    options?: QueueDispatchOptions,
  ): Promise<void> {
    if (options?.handoff !== undefined)
      throw new Error("Identity handoff requires an application queue.");
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

  async dispatch<TPayload extends object>(
    job: Job<TPayload>,
    payload: TPayload,
    options?: QueueDispatchOptions,
  ): Promise<void> {
    if (options?.handoff !== undefined)
      throw new Error("Identity handoff requires an application queue.");
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

export type { JobContext, Queue, QueueDispatchOptions, QueuePriority };
export { AsyncQueue, createQueue, Job, SyncQueue };
