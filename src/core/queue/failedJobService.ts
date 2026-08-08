import FailedJobRepository from "./failedJobRepository";
import type { FailedJobRecord } from "./types";

class FailedJobService {
  constructor(private readonly repository: FailedJobRepository) {}

  async recordFailure(input: {
    jobName: string;
    payload: Record<string, unknown>;
    exception: string;
  }): Promise<FailedJobRecord> {
    return await this.repository.create({
      job_name: input.jobName,
      payload: input.payload,
      exception: input.exception,
      failed_at: new Date(),
    });
  }

  listRecent(limit = 50): Promise<FailedJobRecord[]> {
    return this.repository.findAll({
      limit,
      orderBy: { column: "failed_at", direction: "DESC" },
    });
  }

  async retry(id: number): Promise<FailedJobRecord> {
    const failedJob = await this.repository.findByIdOrThrow(id, (jobId) =>
      new Error(`Failed job ${jobId} not found.`),
    );

    await this.repository.deleteById(id);
    return failedJob;
  }

  async flush(): Promise<number> {
    const jobs = await this.repository.findAll();
    let deleted = 0;

    for (const job of jobs) {
      if (await this.repository.deleteById(job.id)) {
        deleted += 1;
      }
    }

    return deleted;
  }
}

export default FailedJobService;
