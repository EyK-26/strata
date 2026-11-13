import { QueueHandoffError } from "@getstrata/core/queue/queueHandoff";
import { RedisClient } from "bun";
import type { Job, Queue, QueueDispatchOptions } from "./index";
import type { JobRegistry } from "./jobRegistry";
import { parseQueueJobEnvelope, type QueueJobEnvelope, runQueueJob } from "./jobRunner";
import {
  DEFAULT_QUEUE_VISIBILITY_MS,
  type QueueRetryPolicy,
  type QueueRuntimeConfig,
  readQueueVisibilityMs as readVisibilityMs,
  resolveQueueConfig,
  resolveQueueRuntimeConfig,
  snapshotQueueRetryPolicy,
  snapshotQueueRuntimeConfig,
} from "./queueConfig";
import type { QueueServices } from "./queueServices";
import {
  POLL_LIST_PRIORITIES,
  RECLAIM_JOBS,
  RENEW_OR_ACK,
  RESERVE_JOB,
} from "./redisListScripts.ts";
import {
  defaultQueueKeys,
  QUEUE_HIGH_KEY,
  QUEUE_KEYS,
  QUEUE_LIST_KEY,
  QUEUE_LOW_KEY,
  queueKeyForPriority,
} from "./redisQueueKeys";
import { readStreamQueueDepth } from "./redisStreams";

function queueProcessingKey(queueKey: string): string {
  return `${queueKey}:processing`;
}

function queueProcessingLeaseKey(queueKey: string): string {
  return `${queueKey}:processing:leases`;
}

function reservationExpired(lease: string | null, now: number, visibilityMs: number): boolean {
  if (lease === null || lease.length === 0) {
    return true;
  }
  const reservedAt = Number(lease);
  if (!Number.isFinite(reservedAt)) {
    return true;
  }
  return now - reservedAt >= visibilityMs;
}

type QueueReservation = { id: string; owner: string; payload: string; record: string };

// Scripts are atomic against other clients, but Redis does not undo writes on a
// script error. Validate key types first, and publish destination state before
// deleting source state so an unexpected command failure cannot erase work.

// Reclaim every priority, then reserve the first job, in one round trip.
// A later idle poll passes reclaim=0 so an empty wait does not scan processing lists again.

function queueInvalidKey(queueKey: string): string {
  return `${queueKey}:invalid`;
}

async function reserveQueueJob(
  client: RedisClient,
  queueKey: string,
  owner: string,
  visibilityMs = DEFAULT_QUEUE_VISIBILITY_MS,
): Promise<QueueReservation | null> {
  const raw = await client.send("EVAL", [
    RESERVE_JOB,
    "3",
    queueKey,
    queueProcessingKey(queueKey),
    queueProcessingLeaseKey(queueKey),
    crypto.randomUUID(),
    owner,
    String(visibilityMs),
  ]);
  if (typeof raw !== "string") return null;
  const reservation = JSON.parse(raw) as Omit<QueueReservation, "record">;
  return { ...reservation, record: raw };
}

async function updateQueueReservation(
  client: RedisClient,
  queueKey: string,
  reservation: QueueReservation,
  action: "renew" | "ack" | "quarantine",
  visibilityMs = DEFAULT_QUEUE_VISIBILITY_MS,
): Promise<boolean> {
  return (
    Number(
      await client.send("EVAL", [
        RENEW_OR_ACK,
        "3",
        queueProcessingKey(queueKey),
        queueProcessingLeaseKey(queueKey),
        queueInvalidKey(queueKey),
        reservation.id,
        reservation.owner,
        reservation.record,
        action,
        String(visibilityMs),
        reservation.payload,
      ]),
    ) === 1
  );
}

async function pollListPriorities(
  client: RedisClient,
  queueKeys: readonly string[],
  owner: string,
  reservationId: string,
  reclaim: boolean,
  visibilityMs = DEFAULT_QUEUE_VISIBILITY_MS,
): Promise<{ queueKey: string; reservation: QueueReservation } | null> {
  const keys: string[] = [];
  for (const key of queueKeys) {
    keys.push(key, queueProcessingKey(key), queueProcessingLeaseKey(key));
  }
  const raw = await client.send("EVAL", [
    POLL_LIST_PRIORITIES,
    String(keys.length),
    ...keys,
    owner,
    String(visibilityMs),
    reservationId,
    reclaim ? "1" : "0",
  ]);
  if (!Array.isArray(raw)) throw new Error("Invalid Redis list poll response");
  const flag = String(raw[0]);
  if (flag === "0") {
    if (raw.length !== 1) throw new Error("Invalid Redis list poll response");
    return null;
  }
  if (flag !== "1" || raw.length !== 3) throw new Error("Invalid Redis list poll response");
  const index = Number(raw[1]);
  const record = raw[2];
  if (
    !Number.isInteger(index) ||
    index < 1 ||
    index > queueKeys.length ||
    typeof record !== "string"
  ) {
    throw new Error("Invalid Redis list poll response");
  }
  const queueKey = queueKeys[index - 1];
  if (!queueKey) throw new Error("Invalid Redis list poll response");
  const reservation = JSON.parse(record) as Omit<QueueReservation, "record">;
  return { queueKey, reservation: { ...reservation, record } };
}

async function reclaimExpiredQueueReservations(
  client: RedisClient,
  queueKeys: readonly string[] = QUEUE_KEYS,
  visibilityMs = DEFAULT_QUEUE_VISIBILITY_MS,
): Promise<number> {
  let reclaimed = 0;
  for (const key of queueKeys) {
    reclaimed += Number(
      await client.send("EVAL", [
        RECLAIM_JOBS,
        "3",
        key,
        queueProcessingKey(key),
        queueProcessingLeaseKey(key),
        String(visibilityMs),
      ]),
    );
  }
  return reclaimed;
}

class RedisQueue implements Queue {
  private readonly client: RedisClient;

  constructor(
    redisUrl: string,
    private readonly registry: JobRegistry,
    private readonly queueKeys: readonly [string, string, string] = defaultQueueKeys(),
  ) {
    this.queueKeys = Object.freeze([...queueKeys]) as readonly [string, string, string];
    this.client = new RedisClient(redisUrl);
  }

  close(): void {
    this.client.close();
  }

  async dispatch<TPayload extends object>(
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
    const name = this.registry.resolveName(job);

    if (!name) {
      throw new Error("Job is not registered with the queue worker registry.");
    }

    const envelope: QueueJobEnvelope = {
      name,
      jobId: jobId ?? crypto.randomUUID(),
      payload: payload as Record<string, unknown>,
      attempts: 0,
      ...(options?.handoff === undefined ? {} : { handoff: options.handoff }),
    };

    const queueKey = queueKeyForPriority(job.priority, this.queueKeys);
    await this.client.lpush(queueKey, JSON.stringify(envelope));
  }
}

class QueueWorker {
  private readonly retryPolicy: QueueRetryPolicy;
  private readonly owner = crypto.randomUUID();
  private running = false;
  private stopping = false;
  private client: RedisClient;

  constructor(
    private readonly redisUrl: string,
    private readonly failedJobs: Pick<QueueServices, "recordFailure" | "runAttempt">,
    private readonly registry: JobRegistry,
    private readonly timeoutSeconds = 5,
    private readonly queueKeys: readonly string[] = defaultQueueKeys(),
    retryPolicy: QueueRetryPolicy = resolveQueueConfig(),
    private readonly visibilityMs = readVisibilityMs(),
  ) {
    this.queueKeys = Object.freeze([...queueKeys]);
    this.retryPolicy = snapshotQueueRetryPolicy(retryPolicy);
    readVisibilityMs({ QUEUE_VISIBILITY_MS: String(this.visibilityMs) });
    this.client = new RedisClient(redisUrl);
  }

  requestStop(): void {
    this.stopping = true;
  }

  isRunning(): boolean {
    return this.running;
  }

  private async reserve(): Promise<{ queueKey: string; reservation: QueueReservation } | null> {
    const deadline = performance.now() + this.timeoutSeconds * 1000;
    let reclaim = true;
    do {
      if (this.stopping) return null;
      const reserved = await pollListPriorities(
        this.client,
        this.queueKeys,
        this.owner,
        crypto.randomUUID(),
        reclaim,
        this.visibilityMs,
      );
      reclaim = false;
      if (reserved) return reserved;
      if (this.stopping || performance.now() >= deadline) return null;
      await Bun.sleep(Math.min(100, Math.max(1, deadline - performance.now())));
    } while (!this.stopping);
    return null;
  }

  async processNext(): Promise<boolean> {
    if (this.stopping) return false;
    const reserved = await this.reserve();
    if (!reserved) return false;
    const { queueKey, reservation } = reserved;
    const envelope = parseQueueJobEnvelope(reservation.payload, this.registry);
    if (!envelope) {
      await updateQueueReservation(
        this.client,
        queueKey,
        reservation,
        "quarantine",
        this.visibilityMs,
      );
      return true;
    }

    let acknowledge = false;
    let invalidHandoff = false;
    let ownershipLost = false;
    let renewal: Promise<void> | undefined;
    const heartbeat = setInterval(
      () => {
        if (renewal || ownershipLost) return;
        renewal = (async () => {
          try {
            if (
              !(await updateQueueReservation(
                this.client,
                queueKey,
                reservation,
                "renew",
                this.visibilityMs,
              ))
            ) {
              ownershipLost = true;
            }
          } catch (error) {
            ownershipLost = true;
            console.error("[QueueWorker] Lease renewal failed:", error);
          }
        })().finally(() => {
          renewal = undefined;
        });
      },
      Math.max(1, Math.floor(this.visibilityMs / 3)),
    );
    try {
      await runQueueJob(envelope, this.failedJobs, this.registry, {
        retryPolicy: this.retryPolicy,
        onFailureRecorded: () => {
          acknowledge = true;
        },
      });
      acknowledge = true;
    } catch (error) {
      if (error instanceof QueueHandoffError) invalidHandoff = true;
      else console.error("[QueueWorker] Job failed:", error);
    } finally {
      clearInterval(heartbeat);
      await renewal;
    }
    if (invalidHandoff && !ownershipLost) {
      await updateQueueReservation(
        this.client,
        queueKey,
        reservation,
        "quarantine",
        this.visibilityMs,
      );
      return true;
    }
    if (acknowledge && !ownershipLost) {
      await updateQueueReservation(this.client, queueKey, reservation, "ack", this.visibilityMs);
    }
    return true;
  }

  async run(): Promise<void> {
    this.running = true;

    try {
      while (!this.stopping) {
        try {
          await this.processNext();
        } catch (error) {
          if (
            !(
              error &&
              typeof error === "object" &&
              "code" in error &&
              error.code === "ERR_REDIS_CONNECTION_CLOSED"
            )
          )
            throw error;
          // Never replay an uncertain Redis mutation. Pending reservations/retries
          // remain authoritative and are recovered through the normal protocol.
          this.client.close();
          await Bun.sleep(250);
          if (this.stopping) return;
          this.client = new RedisClient(this.redisUrl);
        }
      }
    } finally {
      this.running = false;
    }
  }

  close(): void {
    this.stopping = true;
    this.client.close();
  }
}

async function countPendingQueueJobs(
  redisUrl: string,
  config: QueueRuntimeConfig = resolveQueueRuntimeConfig({}),
): Promise<number> {
  const { transport, queueKeys } = snapshotQueueRuntimeConfig(config);
  const client = new RedisClient(redisUrl);

  try {
    let total = 0;

    for (const queueKey of queueKeys) {
      total +=
        transport === "streams"
          ? await readStreamQueueDepth(client, queueKey)
          : await client.llen(queueKey);
    }

    return total;
  } finally {
    client.close();
  }
}

export type { StreamReservation, StreamsEnqueueOptions } from "./redisStreams";
export {
  migrateLegacyQueueToStreams,
  RedisStreamsQueue,
  RedisStreamsWorker,
  STREAM_GROUP,
  streamDeadLetterKey,
  streamQueueKey,
  updateStreamReservation,
} from "./redisStreams";
export type { QueueJobEnvelope, QueueReservation };
export {
  countPendingQueueJobs,
  parseQueueJobEnvelope,
  pollListPriorities,
  QUEUE_HIGH_KEY,
  QUEUE_LIST_KEY,
  QUEUE_LOW_KEY,
  QueueWorker,
  queueInvalidKey,
  queueKeyForPriority,
  queueProcessingKey,
  queueProcessingLeaseKey,
  RedisQueue,
  reclaimExpiredQueueReservations,
  reservationExpired,
  reserveQueueJob,
  updateQueueReservation,
};
