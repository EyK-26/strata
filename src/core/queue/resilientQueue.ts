import type FailedJobService from "./failedJobService";
import { AsyncQueue, type Job } from "./index";
import { jobRegistry } from "./jobRegistry";
import { runQueueJob } from "./jobRunner";

class ResilientQueue extends AsyncQueue {
  constructor(
    private readonly failedJobs: FailedJobService,
    private readonly asyncDispatch = false,
  ) {
    super();
  }

  override async dispatch<TPayload extends object>(
    job: Job<TPayload>,
    payload: TPayload,
  ): Promise<void> {
    this.assertOpen();
    const name = jobRegistry.resolveName(job);

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
        () => runQueueJob(envelope, this.failedJobs),
        (error) => {
          console.error("[ResilientQueue] Job failed:", error);
        },
      );
      return;
    }

    await runQueueJob(envelope, this.failedJobs);
  }
}

export { ResilientQueue };
