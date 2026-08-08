import { RedisClient } from "bun";
import { Job, type Queue } from "./index";
import { jobRegistry } from "./jobRegistry";

const QUEUE_LIST_KEY = "workhub:queue:default";

interface SerializedQueueJob {
  name: string;
  payload: Record<string, unknown>;
}

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

    const envelope: SerializedQueueJob = {
      name,
      payload: payload as Record<string, unknown>,
    };

    await this.client.lpush(QUEUE_LIST_KEY, JSON.stringify(envelope));
  }
}

class QueueWorker {
  constructor(
    private readonly redisUrl: string,
    private readonly timeoutSeconds = 5,
  ) {}

  async processNext(): Promise<boolean> {
    const client = new RedisClient(this.redisUrl);
    const result = await client.brpop(QUEUE_LIST_KEY, this.timeoutSeconds);

    if (!result) {
      return false;
    }

    const [, rawPayload] = result;
    const envelope = JSON.parse(rawPayload) as SerializedQueueJob;
    const job = jobRegistry.create(envelope.name);

    if (!job) {
      console.error(`[QueueWorker] Unknown job "${envelope.name}".`);
      return true;
    }

    await job.handle(envelope.payload);
    return true;
  }

  async run(): Promise<void> {
    while (true) {
      await this.processNext();
    }
  }
}

export { QUEUE_LIST_KEY, QueueWorker, RedisQueue };
export type { SerializedQueueJob };
