import { describe, expect, test } from "bun:test";
import { setActiveApplicationContext } from "../../src/bootstrap/applicationRegistry";
import { CORE_QUEUE_TOKEN } from "../../src/bootstrap/config";
import { type AppDependencies, ConfigStore, ServiceContainer } from "../../src/bootstrap/contracts";
import { registerInvalidateCacheOnModelWriteListeners } from "../../src/bootstrap/listeners/invalidateCacheOnModelWrite";
import CacheRepository from "../../src/core/cache/repository";
import SimpleCache from "../../src/core/cache/simpleCache";
import SimpleCacheStore from "../../src/core/cache/simpleCacheStore";
import { CACHE_TAGS } from "../../src/core/cache/tags";
import { EventBus } from "../../src/core/events/eventBus";
import { SyncQueue } from "../../src/core/queue";

describe("registerInvalidateCacheOnModelWriteListeners", () => {
  test("flushes tagged cache entries when model write events fire", async () => {
    const bus = new EventBus();
    const container = new ServiceContainer();
    const cache = new CacheRepository(new SimpleCacheStore(new SimpleCache(60_000, 20)));
    const dependencies: AppDependencies = { container, cache };

    container.set(CORE_QUEUE_TOKEN, new SyncQueue());
    setActiveApplicationContext({
      container,
      config: new ConfigStore(),
      dependencies,
    });

    registerInvalidateCacheOnModelWriteListeners(bus);

    await cache
      .tags(CACHE_TAGS.organizations)
      .remember("/organizations", async () => ({ data: [] }));

    expect(await cache.get("/organizations")).toBeDefined();

    await bus.dispatch("organization.created", { id: 1 });

    expect(await cache.get("/organizations")).toBeUndefined();
  });
});
