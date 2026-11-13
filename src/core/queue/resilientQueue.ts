import { AsyncQueue, type Job } from "./index";
import type { JobRegistry } from "./jobRegistry";
import { runQueueJob } from "./jobRunner";
import { type QueueRetryPolicy, resolveQueueConfig, snapshotQueueRetryPolicy } from "./queueConfig";
import type { QueueServices } from "./queueServices";

class ResilientQueue extends AsyncQueue {
  private readonly retryPolicy: QueueRetryPolicy;
  constructor(
    private readonly failedJobs: Pick<QueueServices, "recordFailure" | "runAttempt">,
    private readonly registry: JobRegistry,
    private readonly asyncDispatch = false,
    retryPolicy: QueueRetryPolicy = resolveQueueConfig(),
  ) {
    super();
    this.retryPolicy = snapshotQueueRetryPolicy(retryPolicy);
  }

  override async dispatch<TPayload extends object>(
    job: Job<TPayload>,
    payload: TPayload,
  ): Promise<void> {
    this.assertOpen();
    const name = this.registry.resolveName(job);

    if (!name) {
      throw new Error("Job is not registered with the queue worker registry.");
    }

    const envelope = {
      name,
      payload: payload as Record<string, unknown>,
      attempts: 0,
    };

    if (this.asyncDispatch) {
      this.enqueue(
        () =>
          runQueueJob(envelope, this.failedJobs, this.registry, { retryPolicy: this.retryPolicy }),
        (error) => {
          console.error("[ResilientQueue] Job failed:", error);
        },
      );
      return;
    }

    await runQueueJob(envelope, this.failedJobs, this.registry, { retryPolicy: this.retryPolicy });
  }
}

export { ResilientQueue };
