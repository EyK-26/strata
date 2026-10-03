import { RedisClient } from "bun";
import { namespacedRedisKey } from "../runtime/appKeyPrefix";
import type FailedJobService from "./failedJobService";
import type { Job, Queue, QueuePriority } from "./index";
import { jobRegistry } from "./jobRegistry";
import { type QueueJobEnvelope, runQueueJob } from "./jobRunner";

function queueListKey(): string {
  return namespacedRedisKey("queue:default");
}

function queueHighKey(): string {
  return namespacedRedisKey("queue:high");
}

function queueLowKey(): string {
  return namespacedRedisKey("queue:low");
}

const QUEUE_LIST_KEY = queueListKey();
const QUEUE_HIGH_KEY = queueHighKey();
const QUEUE_LOW_KEY = queueLowKey();
const QUEUE_KEYS = [QUEUE_HIGH_KEY, QUEUE_LIST_KEY, QUEUE_LOW_KEY] as const;
const DEFAULT_VISIBILITY_MS = 60_000;

function queueProcessingKey(queueKey: string): string {
  return `${queueKey}:processing`;
}

function queueProcessingLeaseKey(queueKey: string): string {
  return `${queueKey}:processing:leases`;
}

function readVisibilityMs(): number {
  const parsed = Number(process.env.QUEUE_VISIBILITY_MS ?? String(DEFAULT_VISIBILITY_MS));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_VISIBILITY_MS;
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

function queueKeyForPriority(priority: QueuePriority = "default"): string {
  switch (priority) {
    case "high":
      return queueHighKey();
    case "low":
      return queueLowKey();
    default:
      return queueListKey();
  }
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

  return {
    name: envelope.name,
    payload: (envelope.payload ?? {}) as Record<string, unknown>,
    attempts: typeof envelope.attempts === "number" ? envelope.attempts : 0,
  };
}

async function reclaimExpiredQueueReservations(
  client: RedisClient,
  now = Date.now(),
): Promise<number> {
  const visibilityMs = readVisibilityMs();
  let reclaimed = 0;

  for (const queueKey of QUEUE_KEYS) {
    const processingKey = queueProcessingKey(queueKey);
    const leaseKey = queueProcessingLeaseKey(queueKey);
    const reserved = await client.lrange(processingKey, 0, -1);

    for (const payload of reserved) {
      const lease = await client.hget(leaseKey, payload);
      if (!reservationExpired(lease, now, visibilityMs)) {
        continue;
      }

      const removed = await client.lrem(processingKey, 1, payload);
      if (removed < 1) {
        continue;
      }

      await client.lpush(queueKey, payload);
      await client.hdel(leaseKey, payload);
      reclaimed += 1;
    }
  }

  return reclaimed;
}

class RedisQueue implements Queue {
  private readonly client: RedisClient;

  constructor(redisUrl: string) {
    this.client = new RedisClient(redisUrl);
  }

  async dispatch<TPayload extends object>(job: Job<TPayload>, payload: TPayload): Promise<void> {
    const name = jobRegistry.resolveName(job);

    if (!name) {
      throw new Error("Job is not registered with the queue worker registry.");
    }

    const envelope: QueueJobEnvelope = {
      name,
      payload: payload as Record<string, unknown>,
      attempts: 0,
    };

    const queueKey = queueKeyForPriority(job.priority);
    await this.client.lpush(queueKey, JSON.stringify(envelope));
  }
}

class QueueWorker {
  private running = false;
  private stopping = false;
  private readonly client: RedisClient;

  constructor(
    redisUrl: string,
    private readonly failedJobs: FailedJobService,
    private readonly timeoutSeconds = 5,
  ) {
    this.client = new RedisClient(redisUrl);
  }

  requestStop(): void {
    this.stopping = true;
  }

  isRunning(): boolean {
    return this.running;
  }

  private async acknowledge(queueKey: string, rawPayload: string): Promise<void> {
    await this.client.lrem(queueProcessingKey(queueKey), 1, rawPayload);
    await this.client.hdel(queueProcessingLeaseKey(queueKey), rawPayload);
  }

  private async reserve(queueKey: string, timeoutSeconds: number): Promise<string | null> {
    const rawPayload = await this.client.blmove(
      queueKey,
      queueProcessingKey(queueKey),
      "RIGHT",
      "LEFT",
      timeoutSeconds,
    );

    if (!rawPayload) {
      return null;
    }

    await this.client.hset(queueProcessingLeaseKey(queueKey), rawPayload, String(Date.now()));
    return rawPayload;
  }

  async processNext(): Promise<boolean> {
    await reclaimExpiredQueueReservations(this.client);

    let reserved: { queueKey: string; rawPayload: string } | null = null;

    for (const queueKey of QUEUE_KEYS) {
      const rawPayload = await this.reserve(queueKey, 1);
      if (rawPayload) {
        reserved = { queueKey, rawPayload };
        break;
      }
    }

    if (!reserved) {
      const rawPayload = await this.reserve(QUEUE_LIST_KEY, this.timeoutSeconds);
      if (rawPayload) {
        reserved = { queueKey: QUEUE_LIST_KEY, rawPayload };
      }
    }

    if (!reserved) {
      return false;
    }

    const { queueKey, rawPayload } = reserved;
    const envelope = parseQueueJobEnvelope(rawPayload);
    if (!envelope) {
      await this.acknowledge(queueKey, rawPayload);
      return true;
    }

    try {
      await runQueueJob(envelope, this.failedJobs);
    } catch (error) {
      console.error("[QueueWorker] Job failed:", error);
    } finally {
      await this.acknowledge(queueKey, rawPayload);
    }

    return true;
  }

  async run(): Promise<void> {
    this.running = true;

    while (!this.stopping) {
      await this.processNext();
    }

    this.running = false;
  }

  close(): void {
    this.client.close();
  }
}

async function countPendingQueueJobs(redisUrl: string): Promise<number> {
  const client = new RedisClient(redisUrl);

  try {
    let total = 0;

    for (const queueKey of QUEUE_KEYS) {
      total += await client.llen(queueKey);
    }

    return total;
  } finally {
    client.close();
  }
}

export type { QueueJobEnvelope };
export {
  countPendingQueueJobs,
  parseQueueJobEnvelope,
  QUEUE_HIGH_KEY,
  QUEUE_LIST_KEY,
  QUEUE_LOW_KEY,
  QueueWorker,
  queueKeyForPriority,
  queueProcessingKey,
  queueProcessingLeaseKey,
  RedisQueue,
  reclaimExpiredQueueReservations,
  reservationExpired,
};
