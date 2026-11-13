import { failedJobRepository } from "@getstrata/core/queue/failedJobRepository";
import {
  type QueueHandoff,
  QueueHandoffError,
  type QueueIdentity,
} from "@getstrata/core/queue/queueHandoff";
import type { ExecutionEnvelope } from "../contracts/application";
import type { DatabaseSession } from "../database/session";
import type FailedJobService from "./failedJobService";
import { FailedJobService as LiveFailedJobService } from "./failedJobService";
import type { JobContext } from "./index";
import type { QueueJobEnvelope } from "./jobRunner";

/** Explicit application runner; never retains an execution's database session. */
type QueueInvocation = <T>(
  envelope: ExecutionEnvelope,
  work: (ports: {
    readonly database: DatabaseSession;
    readonly policy?: import("../contracts/persistence").ScopedPolicy;
  }) => T | Promise<T>,
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
  readonly validateReplay?: (record: import("./types").FailedJobRecord) => void;
}
function createFailedJobService(database: DatabaseSession): FailedJobService {
  return new LiveFailedJobService(database.repository(failedJobRepository));
}
function createQueueServices(config: QueueInvocationConfig): QueueServices {
  const { invoke, attemptEnvelope, recoveryEnvelope, validateReplay } = config;
  const jobContext = Object.freeze({ ...config.jobContext });
  const operate = <T>(work: (service: FailedJobService) => Promise<T>, failure?: FailureInput) =>
    invoke(recoveryEnvelope(failure), ({ database }) => work(createFailedJobService(database)));
  return Object.freeze({
    recordFailure: (input: FailureInput) =>
      operate((service) => service.recordFailure(input), input),
    listRecent: (limit?: number) => operate((service) => service.listRecent(limit)),
    retry: (id: number, enqueue: Parameters<FailedJobService["retry"]>[1]) =>
      operate((service) =>
        service.retry(id, async (record) => {
          validateReplay?.(record);
          await enqueue(record);
        }),
      ),
    delete: (id: number) => operate((service) => service.delete(id)),
    flush: () => operate((service) => service.flush()),
    runAttempt: (
      job: QueueJobEnvelope,
      context: JobContext,
      work: (context: JobContext) => Promise<void>,
    ) => {
      const envelope = attemptEnvelope(job, context);
      return invoke(envelope, ({ database, policy }) =>
        work({
          ...context,
          ...jobContext,
          database,
          policy,
          actor: envelope.actor,
          tenant: envelope.tenant,
        }),
      );
    },
  });
}

/** With a verifier, unsigned work is admitted only for the explicit copied system-job allowlist. */
function createSystemQueueServices(
  invoke: QueueInvocation,
  jobContext: Readonly<Pick<JobContext, "cache" | "auditExport">> = {},
  handoff?: QueueHandoff,
  systemJobs: readonly string[] = [],
): QueueServices {
  if (
    !Array.isArray(systemJobs) ||
    systemJobs.some((name) => typeof name !== "string" || !name.length)
  )
    throw new TypeError("System job admission requires explicit job names.");
  const allowedSystemJobs = new Set(systemJobs);
  const establishIdentity = (job: QueueJobEnvelope): QueueIdentity => {
    if (job.handoff === undefined) {
      if (handoff && !allowedSystemJobs.has(job.name)) throw new QueueHandoffError();
      return { actor: { kind: "system", policy: "queue.job" } };
    }
    if (!handoff) throw new QueueHandoffError();
    return handoff.verify(job);
  };
  return createQueueServices({
    invoke,
    jobContext,
    validateReplay: (record) => {
      establishIdentity({
        name: record.job_name,
        payload: record.payload,
        ...(record.handoff == null ? {} : { handoff: record.handoff }),
      });
    },
    attemptEnvelope: (job, context) => {
      const identity = establishIdentity(job);
      return {
        kind: "job",
        externalId: context.jobId,
        signal: context.signal,
        ...(context.deadlineAtMs === undefined ? {} : { deadlineAtMs: context.deadlineAtMs }),
        ...identity,
        metadata: { jobName: job.name, attempt: context.attempt ?? 1 },
      };
    },
    recoveryEnvelope: (failure) => ({
      kind: "command",
      actor: { kind: "system", policy: "queue.recovery" },
      metadata: { phase: "queue-recovery", ...(failure ? { jobName: failure.jobName } : {}) },
    }),
  });
}

export type { QueueInvocation, QueueInvocationConfig, QueueServices };
export { createFailedJobService, createQueueServices, createSystemQueueServices };
