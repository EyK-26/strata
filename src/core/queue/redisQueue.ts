import { RedisClient } from "bun";
import type FailedJobService from "./failedJobService";
import type { Job, Queue, QueuePriority } from "./index";
import { jobRegistry } from "./jobRegistry";
import { type QueueJobEnvelope, runQueueJob } from "./jobRunner";

const QUEUE_LIST_KEY = "workhub:queue:default";
const QUEUE_HIGH_KEY = "workhub:queue:high";
const QUEUE_LOW_KEY = "workhub:queue:low";
const QUEUE_KEYS = [QUEUE_HIGH_KEY, QUEUE_LIST_KEY, QUEUE_LOW_KEY] as const;

function queueKeyForPriority(priority: QueuePriority = "default"): string {
  switch (priority) {
    case "high":
      return QUEUE_HIGH_KEY;
    case "low":
      return QUEUE_LOW_KEY;
    default:
      return QUEUE_LIST_KEY;
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

  async processNext(): Promise<boolean> {
    let result: [string, string] | null = null;

    for (const queueKey of QUEUE_KEYS) {
      result = await this.client.brpop(queueKey, 1);

      if (result) {
        break;
      }
    }

    if (!result) {
      result = await this.client.brpop(QUEUE_LIST_KEY, this.timeoutSeconds);
    }

    if (!result) {
      return false;
    }

    const [, rawPayload] = result;
    const envelope = parseQueueJobEnvelope(rawPayload);
    if (!envelope) {
      return true;
    }

    try {
      await runQueueJob(envelope, this.failedJobs);
    } catch (error) {
      console.error("[QueueWorker] Job failed:", error);
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
  RedisQueue,
};
