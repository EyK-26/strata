import { NotFoundError } from "@getstrata/core/errors/http";
import { FAILED_JOB_SERVICE_TOKEN } from "@getstrata/core/queue/createAppQueue";
import type FailedJobService from "@getstrata/core/queue/failedJobService";
import type { FailedJobRecord } from "@getstrata/core/queue/types";
import { appContainer } from "../../http/currentUser.ts";
import { recordHiringEvent } from "../../lib/hiringEvents.ts";

export type FailedJobView = {
  id: number;
  job_name: string;
  exception: string;
  failed_at: Date;
};

export class FailedJobsAdminService {
  constructor(
    private readonly resolveDriver: () => FailedJobService = () =>
      appContainer().resolve<FailedJobService>(FAILED_JOB_SERVICE_TOKEN),
  ) {}

  present(job: FailedJobRecord): FailedJobView {
    return {
      id: Number(job.id),
      job_name: job.job_name,
      exception: job.exception,
      failed_at: job.failed_at,
    };
  }

  async list(limit = 50) {
    return (await this.resolveDriver().listRecent(limit)).map((job) => this.present(job));
  }

  async retry(id: number) {
    try {
      const retried = await this.resolveDriver().retry(id);
      await recordHiringEvent(
        "failed_job.retried",
        { id: Number(retried.id), job_name: retried.job_name },
        { type: "failed_job", id: Number(retried.id) },
      );
      return {
        retried: true as const,
        id: Number(retried.id),
        job_name: retried.job_name,
      };
    } catch {
      throw new NotFoundError("Failed job not found.");
    }
  }
}

export const failedJobsAdmin = new FailedJobsAdminService();
