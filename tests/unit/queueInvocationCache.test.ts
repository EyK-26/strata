import { expect, test } from "bun:test";
import { registerDefaultJobs } from "@getstrata/bootstrap/queue/defaultJobs";
import { CacheRepository } from "@getstrata/core/cache/repository";
import { SimpleCache } from "@getstrata/core/cache/simpleCache";
import { SimpleCacheStore } from "@getstrata/core/cache/simpleCacheStore";
import { InvalidateCacheTagsJob } from "@getstrata/core/jobs/invalidateCacheTagsJob";
import { jobRegistry } from "@getstrata/core/queue/jobRegistry";
import { createSystemQueueServices } from "@getstrata/core/queue/queueServices";
import { ResilientQueue } from "@getstrata/core/queue/resilientQueue";
import { createQueuePersistenceFixture } from "../helpers/queuePersistence";

test("two applications execute the same asynchronous cache job definition against their own cache", async () => {
  const a = await createQueuePersistenceFixture(),
    b = await createQueuePersistenceFixture();
  const cacheA = new CacheRepository(new SimpleCacheStore(new SimpleCache(10000, 20))),
    cacheB = new CacheRepository(new SimpleCacheStore(new SimpleCache(10000, 20)));
  registerDefaultJobs();
  const queueA = new ResilientQueue(createSystemQueueServices(a.invoke, { cache: cacheA }), true),
    queueB = new ResilientQueue(createSystemQueueServices(b.invoke, { cache: cacheB }), true);
  try {
    await cacheA.tags("shared").remember("entry", async () => "A");
    await cacheB.tags("shared").remember("entry", async () => "B");
    const jobA = new InvalidateCacheTagsJob(),
      jobB = new InvalidateCacheTagsJob();
    jobRegistry.track("cache.invalidate-tags", jobA);
    jobRegistry.track("cache.invalidate-tags", jobB);
    await queueA.dispatch(jobA, { tags: ["shared"] });
    await queueA.close();
    expect(await cacheA.get("entry")).toBeUndefined();
    expect(await cacheB.get("entry")).toBe("B");
    await queueB.dispatch(jobB, { tags: ["shared"] });
    await queueB.close();
    expect(await cacheB.get("entry")).toBeUndefined();
  } finally {
    await queueA.close();
    await queueB.close();
    expect((await a.application.stop()).successful).toBe(true);
    expect((await b.application.stop()).successful).toBe(true);
    await cacheA.close();
    await cacheB.close();
  }
});
