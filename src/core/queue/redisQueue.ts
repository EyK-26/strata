import { RedisClient } from "bun";
import { Job, type Queue } from "./index";
import { jobRegistry } from "./jobRegistry";
import FailedJobService from "./failedJobService";
import { runQueueJob, type QueueJobEnvelope } from "./jobRunner";

const QUEUE_LIST_KEY = "workhub:queue:default";

class RedisQueue implements Queue {
  private readonly client: RedisClient;

  constructor(redisUrl: string) {
    this.client = new RedisClient(redisUrl);
  }

  async dispatch<TPayload extends object>(
    job: Job<TPayload>,
    payload: TPayload,
  ): Promise<void> {
    const name = jobRegistry.resolveName(job);

    if (!name) {
      throw new Error("Job is not registered with the queue worker registry.");
    }

    const envelope: QueueJobEnvelope = {
      name,
      payload: payload as Record<string, unknown>,
      attempts: 0,
    };

    await this.client.lpush(QUEUE_LIST_KEY, JSON.stringify(envelope));
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
    const result = await client.brpop(QUEUE_LIST_KEY, this.timeoutSeconds);

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

export { QUEUE_LIST_KEY, QueueWorker, RedisQueue };
export type { QueueJobEnvelope };
