import { setTimeout as delay } from "node:timers/promises";
import { copyApplicationConfig } from "../config/configSnapshot";
import type { JobRegistry } from "./jobRegistry";
import { type QueueRetryPolicy, resolveQueueConfig, snapshotQueueRetryPolicy } from "./queueConfig";
import type { QueueServices } from "./queueServices";

interface QueueJobEnvelope {
  name: string;
  handoff?: string;
  payload: Record<string, unknown>;
  attempts?: number;
  jobId?: string;
  deadlineAtMs?: number;
  cancellable?: boolean;
}

/** Capture the exact data that admission authenticates, before any asynchronous resource acquisition. */
function snapshotQueueJobEnvelope(input: QueueJobEnvelope): QueueJobEnvelope {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    throw new TypeError("Queue envelope must be plain data.");
  const data: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(input)) {
    if (
      typeof key !== "string" ||
      !["name", "payload", "attempts", "jobId", "deadlineAtMs", "cancellable", "handoff"].includes(
        key,
      )
    )
      throw new TypeError("Unknown queue envelope field.");
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
      throw new TypeError("Queue envelope must contain own data fields.");
    if (descriptor.value !== undefined)
      Object.defineProperty(data, key, { value: descriptor.value, enumerable: true });
  }
  const captured = copyApplicationConfig(data) as unknown as QueueJobEnvelope;
  if (
    typeof captured.name !== "string" ||
    !captured.name ||
    !captured.payload ||
    typeof captured.payload !== "object" ||
    Array.isArray(captured.payload)
  )
    throw new TypeError("Queue envelope requires a job name and payload record.");
  return captured;
}

function parseQueueJobEnvelope(rawPayload: string, registry: JobRegistry): QueueJobEnvelope | null {
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
  if (
    Object.keys(parsed).some(
      (key) =>
        ![
          "name",
          "payload",
          "attempts",
          "jobId",
          "deadlineAtMs",
          "cancellable",
          "handoff",
        ].includes(key),
    )
  )
    return null;
  if (
    envelope.handoff !== undefined &&
    (typeof envelope.handoff !== "string" ||
      !envelope.handoff.length ||
      envelope.handoff.length > 32768)
  )
    return null;
  if (typeof envelope.name !== "string" || envelope.name.length === 0) {
    console.error("[QueueWorker] Ignoring queue payload without job name");
    return null;
  }

  if (!registry.has(envelope.name)) {
    console.error(`[QueueWorker] Ignoring unknown job name: ${envelope.name}`);
    return null;
  }

  if (
    envelope.payload !== undefined &&
    (typeof envelope.payload !== "object" ||
      envelope.payload === null ||
      Array.isArray(envelope.payload))
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
    ...(envelope.handoff === undefined ? {} : { handoff: envelope.handoff }),
    jobId: envelope.jobId,
    name: envelope.name,
    payload: (envelope.payload ?? {}) as Record<string, unknown>,
    attempts: typeof envelope.attempts === "number" ? envelope.attempts : 0,
  };
}

async function runQueueJob(
  envelope: QueueJobEnvelope,
  failedJobs: Pick<QueueServices, "recordFailure" | "runAttempt">,
  registry: JobRegistry,
  options: {
    retryPolicy?: QueueRetryPolicy;
    onFailureRecorded?: () => void;
    context?: import("./index").JobContext;
    deferRetry?: (envelope: QueueJobEnvelope, delayMs: number) => Promise<void>;
  } = {},
): Promise<void> {
  envelope = snapshotQueueJobEnvelope(envelope);
  const retryPolicy = snapshotQueueRetryPolicy(options.retryPolicy ?? resolveQueueConfig());
  options.context?.signal.throwIfAborted();
  if (!registry.has(envelope.name)) {
    throw new Error(`Unknown job "${envelope.name}".`);
  }

  const attempts = envelope.attempts ?? 0;
  const context = options.context ?? {
    jobId: envelope.jobId ?? crypto.randomUUID(),
    signal: new AbortController().signal,
  };

  let job: import("./index").Job | undefined;
  try {
    await failedJobs.runAttempt(envelope, { ...context, attempt: attempts + 1 }, (scoped) => {
      scoped.signal.throwIfAborted();
      job = registry.create(envelope.name);
      if (!job) throw new Error(`Unknown job "${envelope.name}".`);
      return job.handle(envelope.payload, scoped);
    });
  } catch (error) {
    options.context?.signal.throwIfAborted();
    // Admission failures have no job attempt to retry or record as a business failure.
    if (!job) throw error;
    const nextAttempt = attempts + 1;
    const maxAttempts = job.maxAttempts ?? retryPolicy.maxAttempts;

    if (nextAttempt < maxAttempts) {
      const backoffMs = job.backoffMs ?? retryPolicy.backoffMs;
      if (options.deferRetry) {
        await options.deferRetry(
          { ...envelope, jobId: context.jobId, attempts: nextAttempt },
          backoffMs * nextAttempt,
        );
        return;
      }
      await delay(backoffMs * nextAttempt, undefined, { signal: options.context?.signal });
      await runQueueJob(
        {
          ...envelope,
          attempts: nextAttempt,
        },
        failedJobs,
        registry,
        { ...options, context, retryPolicy },
      );
      return;
    }

    await failedJobs.recordFailure({
      jobName: envelope.name,
      ...(envelope.handoff === undefined ? {} : { handoff: envelope.handoff }),
      jobId: context.jobId,
      payload: envelope.payload,
      exception: error instanceof Error ? (error.stack ?? error.message) : String(error),
    });

    options.onFailureRecorded?.();
    throw error;
  }
}

export type { QueueJobEnvelope };
export { parseQueueJobEnvelope, runQueueJob, snapshotQueueJobEnvelope };
