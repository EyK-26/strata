import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { ensureModulesLoaded } from "@getstrata/bootstrap/discoverModules";
import { createModelCacheInvalidationEffects } from "@getstrata/bootstrap/listeners/invalidateCacheOnModelWrite";
import { CacheRepository } from "@getstrata/core/cache/repository";
import { SimpleCache } from "@getstrata/core/cache/simpleCache";
import { SimpleCacheStore } from "@getstrata/core/cache/simpleCacheStore";
import { CACHE_TAGS } from "@getstrata/core/cache/tags";
import { createServiceToken } from "@getstrata/core/contracts/token";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { defineRepository } from "@getstrata/core/database/definitions";
import { InvalidateCacheTagsJob } from "@getstrata/core/jobs/invalidateCacheTagsJob";
import type { Queue } from "@getstrata/core/queue";
import type { CacheLike } from "../../src/types/services";

const FIXTURE_MODULES = join(import.meta.dir, "../fixtures/discover-modules");

const modules = await ensureModulesLoaded({ modulesDir: FIXTURE_MODULES });

describe("createModelCacheInvalidationEffects", () => {
  test("registers organization write listeners", () => {
    const definition = defineRepository({
      name: "Organization",
      table: { name: "organization", primaryKey: "id", columns: ["id"] },
      dependencies: [],
      create: (binding) => new BaseRepository(binding),
    });
    const declarations = createModelCacheInvalidationEffects([definition], modules, {
      cache: createServiceToken<CacheLike>("cache"),
      queue: createServiceToken<Queue>("queue"),
    });
    const events = declarations.repositoryEffects.flatMap((value) =>
      value.effects.map((effect) => `${value.definition.table.name}.${effect.action}`),
    );
    expect(events).toContain("organization.created");
    expect(events).toContain("organization.updated");
    expect(Object.isFrozen(declarations.repositoryEffects)).toBe(true);
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
