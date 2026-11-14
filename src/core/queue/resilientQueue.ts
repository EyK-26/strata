import { AsyncQueue, type Job, type QueueDispatchOptions } from "./index";
import type { JobRegistry } from "./jobRegistry";
import { runQueueJob, snapshotQueueJobEnvelope } from "./jobRunner";
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
    options?: QueueDispatchOptions,
  ): Promise<void> {
    await this.admit(job, payload, options);
  }

  async replay<TPayload extends object>(
    job: Job<TPayload>,
    payload: TPayload,
    jobId: string,
    options?: QueueDispatchOptions,
  ): Promise<void> {
    if (typeof jobId !== "string" || !jobId.length)
      throw new TypeError("Replay identity is required.");
    await this.admit(job, payload, options, jobId);
  }

  private async admit<TPayload extends object>(
    job: Job<TPayload>,
    payload: TPayload,
    options?: QueueDispatchOptions,
    jobId?: string,
  ): Promise<void> {
    this.assertOpen();
    const name = this.registry.resolveName(job);

    if (!name) {
      throw new Error("Job is not registered with the queue worker registry.");
    }

    const envelope = snapshotQueueJobEnvelope({
      name,
      jobId: jobId ?? crypto.randomUUID(),
      payload: payload as Record<string, unknown>,
      attempts: 0,
      ...(options?.handoff === undefined ? {} : { handoff: options.handoff }),
    });

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

    await this.track(
      Promise.resolve().then(() =>
        runQueueJob(envelope, this.failedJobs, this.registry, { retryPolicy: this.retryPolicy }),
      ),
    );
  }
}

export { ResilientQueue };
