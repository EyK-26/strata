import { beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  configureModulesDirectory,
  ensureModulesLoaded,
  resetDiscoverModulesForTests,
} from "@getstrata/bootstrap/discoverModules";
import { registerInvalidateCacheOnModelWriteListeners } from "@getstrata/bootstrap/listeners/invalidateCacheOnModelWrite";
import { CacheRepository } from "@getstrata/core/cache/repository";
import { SimpleCache } from "@getstrata/core/cache/simpleCache";
import { SimpleCacheStore } from "@getstrata/core/cache/simpleCacheStore";
import { CACHE_TAGS } from "@getstrata/core/cache/tags";
import { EventBus } from "@getstrata/core/events";
import { InvalidateCacheTagsJob } from "@getstrata/core/jobs/invalidateCacheTagsJob";

const FIXTURE_MODULES = join(import.meta.dir, "../fixtures/discover-modules");

beforeAll(async () => {
  resetDiscoverModulesForTests();
  configureModulesDirectory(FIXTURE_MODULES);
  await ensureModulesLoaded();
});

describe("registerInvalidateCacheOnModelWriteListeners", () => {
  test("registers organization write listeners", () => {
    const bus = new EventBus();
    const events: string[] = [];
    const originalListen = bus.listen.bind(bus);

    bus.listen = (event, handler) => {
      events.push(event);
      return originalListen(event, handler);
    };

    registerInvalidateCacheOnModelWriteListeners(bus);

    expect(events).toContain("organization.created");
    expect(events).toContain("organization.updated");
  });

  test("InvalidateCacheTagsJob flushes tagged cache entries", async () => {
    const cache = new CacheRepository(new SimpleCacheStore(new SimpleCache(60_000, 20)));
    const job = new InvalidateCacheTagsJob(cache);

    await cache
      .tags(CACHE_TAGS.organizations)
      .remember("/organizations", async () => ({ data: [] }));

    expect(await cache.get("/organizations")).toBeDefined();

    await job.handle({ tags: [CACHE_TAGS.organizations] });

    expect(await cache.get("/organizations")).toBeUndefined();
  });
});
