import { beforeAll, describe, expect, test } from "bun:test";
import { ensureModulesLoaded } from "@getstrata/bootstrap/discoverModules";
import { registerInvalidateCacheOnModelWriteListeners } from "../../src/bootstrap/listeners/invalidateCacheOnModelWrite";
import CacheRepository from "../../src/core/cache/repository";
import SimpleCache from "../../src/core/cache/simpleCache";
import SimpleCacheStore from "../../src/core/cache/simpleCacheStore";
import { CACHE_TAGS } from "../../src/core/cache/tags";
import { EventBus } from "../../src/core/events/eventBus";
import InvalidateCacheTagsJob from "../../src/core/jobs/invalidateCacheTagsJob";

beforeAll(async () => {
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
