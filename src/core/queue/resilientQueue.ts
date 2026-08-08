import { Job, type Queue } from "./index";
import { jobRegistry } from "./jobRegistry";
import FailedJobService from "./failedJobService";
import { runQueueJob } from "./jobRunner";

class ResilientQueue implements Queue {
  constructor(
    private readonly failedJobs: FailedJobService,
    private readonly asyncDispatch = false,
  ) {}

  async dispatch<TPayload extends object>(
    job: Job<TPayload>,
    payload: TPayload,
  ): Promise<void> {
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
      setTimeout(() => {
        void runQueueJob(envelope, this.failedJobs).catch((error) => {
          console.error("[ResilientQueue] Job failed:", error);
        });
      }, 0);
      return;
    }

    await runQueueJob(envelope, this.failedJobs);
  }
}

export { ResilientQueue };
