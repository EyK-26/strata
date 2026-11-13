import { failedJobRepository } from "@getstrata/core/queue/failedJobRepository";
import type { ExecutionEnvelope } from "../contracts/application";
import type { DatabaseSession } from "../database/session";
import type FailedJobService from "./failedJobService";
import { FailedJobService as LiveFailedJobService } from "./failedJobService";
import type { JobContext } from "./index";
import type { QueueJobEnvelope } from "./jobRunner";

/** Explicit application runner; never retains an execution's database session. */
type QueueInvocation = <T>(
  envelope: ExecutionEnvelope,
  work: (ports: { readonly database: DatabaseSession }) => T | Promise<T>,
) => Promise<T>;
type FailureInput = Parameters<FailedJobService["recordFailure"]>[0];
interface QueueServices
  extends Pick<FailedJobService, "recordFailure" | "listRecent" | "retry" | "delete" | "flush"> {
  runAttempt(
    envelope: QueueJobEnvelope,
    context: JobContext,
    work: (context: JobContext) => Promise<void>,
  ): Promise<void>;
}
interface QueueInvocationConfig {
  readonly jobContext?: Readonly<Pick<JobContext, "cache" | "auditExport">>;
  readonly invoke: QueueInvocation;
  readonly attemptEnvelope: (job: QueueJobEnvelope, context: JobContext) => ExecutionEnvelope;
  readonly recoveryEnvelope: (failure?: FailureInput) => ExecutionEnvelope;
}
function createFailedJobService(database: DatabaseSession): FailedJobService {
  return new LiveFailedJobService(database.repository(failedJobRepository));
}
function createQueueServices(config: QueueInvocationConfig): QueueServices {
  const { invoke, attemptEnvelope, recoveryEnvelope } = config;
  const jobContext = Object.freeze({ ...config.jobContext });
  const operate = <T>(work: (service: FailedJobService) => Promise<T>, failure?: FailureInput) =>
    invoke(recoveryEnvelope(failure), ({ database }) => work(createFailedJobService(database)));
  return Object.freeze({
    recordFailure: (input: FailureInput) =>
      operate((service) => service.recordFailure(input), input),
    listRecent: (limit?: number) => operate((service) => service.listRecent(limit)),
    retry: (...args: Parameters<FailedJobService["retry"]>) =>
      operate((service) => service.retry(...args)),
    delete: (id: number) => operate((service) => service.delete(id)),
    flush: () => operate((service) => service.flush()),
    runAttempt: (
      job: QueueJobEnvelope,
      context: JobContext,
      work: (context: JobContext) => Promise<void>,
    ) =>
      invoke(attemptEnvelope(job, context), ({ database }) =>
        work({ ...context, ...jobContext, database }),
      ),
  });
}

function createSystemQueueServices(
  invoke: QueueInvocation,
  jobContext: Readonly<Pick<JobContext, "cache" | "auditExport">> = {},
): QueueServices {
  return createQueueServices({
    invoke,
    jobContext,
    attemptEnvelope: (job, context) => ({
      kind: "job",
      externalId: context.jobId,
      signal: context.signal,
      ...(context.deadlineAtMs === undefined ? {} : { deadlineAtMs: context.deadlineAtMs }),
      actor: { kind: "system", policy: "queue.job" },
      metadata: { jobName: job.name, attempt: context.attempt ?? 1 },
    }),
    recoveryEnvelope: (failure) => ({
      kind: "command",
      actor: { kind: "system", policy: "queue.recovery" },
      metadata: { phase: "queue-recovery", ...(failure ? { jobName: failure.jobName } : {}) },
    }),
  });
}

export type { QueueInvocation, QueueInvocationConfig, QueueServices };
export { createFailedJobService, createQueueServices, createSystemQueueServices };
