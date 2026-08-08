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

  constructor(
    private readonly redisUrl: string,
    private readonly failedJobs: FailedJobService,
    private readonly timeoutSeconds = 5,
  ) {}

  requestStop(): void {
    this.stopping = true;
  }

  isRunning(): boolean {
    return this.running;
  }

  async processNext(): Promise<boolean> {
    const client = new RedisClient(this.redisUrl);
    let result: [string, string] | null = null;

    for (const queueKey of QUEUE_KEYS) {
      result = await client.brpop(queueKey, 1);

      if (result) {
        break;
      }
    }

    if (!result) {
      result = await client.brpop(QUEUE_LIST_KEY, this.timeoutSeconds);
    }

    if (!result) {
      return false;
    }

    const [, rawPayload] = result;
    const envelope = JSON.parse(rawPayload) as QueueJobEnvelope;

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
}

export type { QueueJobEnvelope };
export {
  QUEUE_HIGH_KEY,
  QUEUE_LIST_KEY,
  QUEUE_LOW_KEY,
  QueueWorker,
  queueKeyForPriority,
  RedisQueue,
};
