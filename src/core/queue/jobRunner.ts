import { setTimeout as delay } from "node:timers/promises";
import type FailedJobService from "./failedJobService";
import { jobRegistry } from "./jobRegistry";
import { queueConfig } from "./queueConfig";

interface QueueJobEnvelope {
  name: string;
  payload: Record<string, unknown>;
  attempts?: number;
  jobId?: string;
  deadlineAtMs?: number;
  cancellable?: boolean;
}

function parseQueueJobEnvelope(rawPayload: string): QueueJobEnvelope | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawPayload);
  } catch {
    console.error("[QueueWorker] Ignoring malformed queue payload");
    return null;
  }

  if (!parsed || typeof parsed !== "object") {
    console.error("[QueueWorker] Ignoring non-object queue payload");
    return null;
  }

  const envelope = parsed as Partial<QueueJobEnvelope>;
  if (typeof envelope.name !== "string" || envelope.name.length === 0) {
    console.error("[QueueWorker] Ignoring queue payload without job name");
    return null;
  }

  if (!jobRegistry.create(envelope.name)) {
    console.error(`[QueueWorker] Ignoring unknown job name: ${envelope.name}`);
    return null;
  }

  if (
    envelope.payload !== undefined &&
    (typeof envelope.payload !== "object" || envelope.payload === null)
  ) {
    console.error("[QueueWorker] Ignoring queue payload with invalid payload object");
    return null;
  }

  if (
    envelope.jobId !== undefined &&
    (typeof envelope.jobId !== "string" || !envelope.jobId.length)
  )
    return null;
  if (
    envelope.attempts !== undefined &&
    (!Number.isSafeInteger(envelope.attempts) || envelope.attempts < 0)
  )
    return null;

  if (
    envelope.deadlineAtMs !== undefined &&
    (!Number.isSafeInteger(envelope.deadlineAtMs) || envelope.deadlineAtMs <= 0)
  )
    return null;

  if (
    envelope.cancellable !== undefined &&
    (typeof envelope.cancellable !== "boolean" || (envelope.cancellable && !envelope.jobId))
  )
    return null;

  return {
    ...(envelope.cancellable ? { cancellable: true } : {}),
    ...(envelope.deadlineAtMs === undefined ? {} : { deadlineAtMs: envelope.deadlineAtMs }),
    jobId: envelope.jobId,
    name: envelope.name,
    payload: (envelope.payload ?? {}) as Record<string, unknown>,
    attempts: typeof envelope.attempts === "number" ? envelope.attempts : 0,
  };
}

async function runQueueJob(
  envelope: QueueJobEnvelope,
  failedJobs: FailedJobService,
  options: {
    onFailureRecorded?: () => void;
    context?: import("./index").JobContext;
    deferRetry?: (envelope: QueueJobEnvelope, delayMs: number) => Promise<void>;
  } = {},
): Promise<void> {
  options.context?.signal.throwIfAborted();
  const job = jobRegistry.create(envelope.name);

  if (!job) {
    throw new Error(`Unknown job "${envelope.name}".`);
  }

  const attempts = envelope.attempts ?? 0;

  try {
    await job.handle(envelope.payload, options.context);
  } catch (error) {
    options.context?.signal.throwIfAborted();
    const nextAttempt = attempts + 1;
    const maxAttempts = job.maxAttempts ?? queueConfig.maxAttempts;

    if (nextAttempt < maxAttempts) {
      const backoffMs = job.backoffMs ?? queueConfig.backoffMs;
      if (options.deferRetry) {
        await options.deferRetry({ ...envelope, attempts: nextAttempt }, backoffMs * nextAttempt);
        return;
      }
      await delay(backoffMs * nextAttempt, undefined, { signal: options.context?.signal });
      await runQueueJob(
        {
          ...envelope,
          attempts: nextAttempt,
        },
        failedJobs,
        options,
      );
      return;
    }

    await failedJobs.recordFailure({
      jobName: envelope.name,
      payload: envelope.payload,
      exception: error instanceof Error ? (error.stack ?? error.message) : String(error),
    });

    options.onFailureRecorded?.();
    throw error;
  }
}

export type { QueueJobEnvelope };
export { parseQueueJobEnvelope, runQueueJob };
