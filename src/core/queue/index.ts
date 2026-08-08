type QueuePriority = "high" | "default" | "low";

abstract class Job<TPayload extends object = object> {
  readonly maxAttempts?: number;
  readonly backoffMs?: number;
  readonly priority?: QueuePriority;

  abstract handle(payload: TPayload): Promise<void>;
}

interface Queue {
  dispatch<TPayload extends object>(
    job: Job<TPayload>,
    payload: TPayload,
  ): Promise<void>;
}

class SyncQueue implements Queue {
  async dispatch<TPayload extends object>(
    job: Job<TPayload>,
    payload: TPayload,
  ): Promise<void> {
    await job.handle(payload);
  }
}

class AsyncQueue implements Queue {
  async dispatch<TPayload extends object>(
    job: Job<TPayload>,
    payload: TPayload,
  ): Promise<void> {
    setTimeout(() => {
      void job.handle(payload).catch((error) => {
        console.error("[AsyncQueue] Job failed:", error);
      });
    }, 0);
  }
}

function createQueue(driver: "sync" | "async"): Queue {
  return driver === "async" ? new AsyncQueue() : new SyncQueue();
}

export { AsyncQueue, Job, SyncQueue, createQueue };
export type { Queue, QueuePriority };
