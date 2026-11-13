import { expect, test } from "bun:test";
import { CORE_CACHE_TOKEN, CORE_QUEUE_TOKEN } from "@getstrata/bootstrap/config";
import type { ProviderContext } from "@getstrata/bootstrap/contracts";
import { createQueueProvider } from "@getstrata/bootstrap/providers/queue";
import { CacheRepository } from "@getstrata/core/cache/repository";
import { SimpleCache } from "@getstrata/core/cache/simpleCache";
import { SimpleCacheStore } from "@getstrata/core/cache/simpleCacheStore";
import { ConfigStore, ServiceContainer } from "@getstrata/core/contracts/container";
import { Job } from "@getstrata/core/queue";
import { QUEUE_JOB_REGISTRY_TOKEN } from "@getstrata/core/queue/jobRegistry";
import { createPersistenceInvocation } from "../../src/bootstrap/persistenceInvocation";
import { createQueuePersistenceFixture } from "../helpers/queuePersistence";

test("queue provider retains declared retry policy when environment changes before startup", async () => {
  const provider = createQueueProvider({
    QUEUE_DRIVER: "sync",
    QUEUE_MAX_ATTEMPTS: "3",
    QUEUE_BACKOFF_MS: "0",
  });
  const prior = process.env.QUEUE_MAX_ATTEMPTS;
  process.env.QUEUE_MAX_ATTEMPTS = "1";
  const fixture = await createQueuePersistenceFixture();
  const cache = new CacheRepository(new SimpleCacheStore(new SimpleCache(10000, 20)));
  const container = new ServiceContainer();
  container.set(CORE_CACHE_TOKEN, cache);
  const cleanups: Array<() => void | Promise<void>> = [];
  const invoke = createPersistenceInvocation(fixture.application, "test");
  const context: ProviderContext = {
    container,
    config: new ConfigStore(),
    invoke,
    dependencies: { container, invoke },
    onCleanup: (cleanup) => {
      cleanups.push(cleanup);
    },
  };
  let attempts = 0;
  class Retry extends Job {
    static override readonly jobName = "provider.snapshot.retry";
    async handle() {
      attempts++;
      if (attempts < 3) throw new Error("transient");
    }
  }
  try {
    await provider.register?.(context);
    container.resolve(QUEUE_JOB_REGISTRY_TOKEN).register(Retry.jobName, () => new Retry());
    await container.resolve(CORE_QUEUE_TOKEN).dispatch(new Retry(), {});
    expect(attempts).toBe(3);
  } finally {
    for (const cleanup of cleanups.reverse()) await cleanup();
    await cache.close();
    expect((await fixture.application.stop()).successful).toBe(true);
    if (prior === undefined) delete process.env.QUEUE_MAX_ATTEMPTS;
    else process.env.QUEUE_MAX_ATTEMPTS = prior;
  }
});
