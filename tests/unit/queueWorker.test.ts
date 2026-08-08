import { describe, expect, test } from "bun:test";
import { Job } from "../../src/core/queue";
import { jobRegistry } from "../../src/core/queue/jobRegistry";
import { registerDefaultJobs } from "../../src/core/queue/createAppQueue";
import { QUEUE_LIST_KEY, QueueWorker, RedisQueue } from "../../src/core/queue/redisQueue";
import { setActiveApplicationContext } from "../../src/bootstrap/applicationRegistry";
import {
  ConfigStore,
  ServiceContainer,
  type AppDependencies,
} from "../../src/bootstrap/contracts";
import CacheRepository from "../../src/core/cache/repository";
import SimpleCache from "../../src/core/cache/simpleCache";
import SimpleCacheStore from "../../src/core/cache/simpleCacheStore";
import { RedisClient } from "bun";

interface EchoPayload {
  message: string;
}

function bootstrapQueueContext(): AppDependencies {
  const container = new ServiceContainer();
  const cache = new CacheRepository(
    new SimpleCacheStore(new SimpleCache(60_000, 20)),
  );
  const dependencies = { container, cache };

  setActiveApplicationContext({
    container,
    config: new ConfigStore(),
    dependencies,
  });

  return dependencies;
}

describe("QueueWorker", () => {
  test("processes a tracked redis job", async () => {
    const redisUrl = process.env.REDIS_URL;

    if (!redisUrl) {
      console.warn("Skipping QueueWorker test because REDIS_URL is not set.");
      return;
    }

    bootstrapQueueContext();
    registerDefaultJobs();

    const messages: string[] = [];

    class EchoJob extends Job<EchoPayload> {
      override async handle(payload: EchoPayload): Promise<void> {
        messages.push(payload.message);
      }
    }

    const echoJob = new EchoJob();
    jobRegistry.register("test.echo", () => echoJob);
    jobRegistry.track("test.echo", echoJob);
    const queue = new RedisQueue(redisUrl);
    const worker = new QueueWorker(redisUrl, 1);
    const client = new RedisClient(redisUrl);

    await client.del(QUEUE_LIST_KEY);
    await queue.dispatch(echoJob, { message: "hello-worker" });

    const processed = await worker.processNext();

    expect(processed).toBe(true);
    expect(messages).toEqual(["hello-worker"]);
  });
});
