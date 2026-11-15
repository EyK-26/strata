import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { ensureModulesLoaded } from "@getstrata/bootstrap/discoverModules";
import { createModelCacheInvalidationEffects } from "@getstrata/bootstrap/listeners/invalidateCacheOnModelWrite";
import { CacheRepository } from "@getstrata/core/cache/repository";
import { SimpleCache } from "@getstrata/core/cache/simpleCache";
import { SimpleCacheStore } from "@getstrata/core/cache/simpleCacheStore";
import { CACHE_TAGS } from "@getstrata/core/cache/tags";
import { valueService } from "@getstrata/core/contracts/services";
import { createServiceToken } from "@getstrata/core/contracts/token";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { createDatabaseBindings } from "@getstrata/core/database/bindings";
import { defineRepository } from "@getstrata/core/database/definitions";
import { defineModel, field } from "@getstrata/core/database/model";
import { DATABASE_SESSION_TOKEN } from "@getstrata/core/database/tokens";
import { InvalidateCacheTagsJob } from "@getstrata/core/jobs/invalidateCacheTagsJob";
import { type Queue, SyncQueue } from "@getstrata/core/queue";
import { createApplication } from "@getstrata/core/runtime/application";
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
      value.effects.map((effect) => `${definition.table.name}.${effect.action}`),
    );
    expect(events).toContain("organization.created");
    expect(events).toContain("organization.updated");
    expect(Object.isFrozen(declarations.repositoryEffects)).toBe(true);
  });

  test("class-only models retain write invalidation without a repository declaration", () => {
    class Organization extends defineModel({
      table: "organization",
      fields: { id: field.number() },
    }) {}
    const declarations = createModelCacheInvalidationEffects(
      [],
      modules,
      {
        cache: createServiceToken<CacheLike>("class-cache"),
        queue: createServiceToken<Queue>("class-queue"),
      },
      [Organization],
    );
    expect(declarations.repositoryEffects.length).toBeGreaterThan(0);
    expect(
      declarations.repositoryEffects.every((effect) => effect.definition === Organization),
    ).toBe(true);
    expect(
      declarations.repositoryEffects.flatMap((effect) => effect.effects.map((item) => item.action)),
    ).toEqual(["created", "updated", "deleted", "restored", "force-deleted"]);
  });

  test("class model writes invalidate cached rows only after commit", async () => {
    class Organization extends defineModel({
      table: "organization",
      fields: { id: field.number() },
    }) {
      static $fillable = ["id"] as const;
    }
    const cache = new CacheRepository(new SimpleCacheStore(new SimpleCache(60_000, 20)));
    const tokens = {
      cache: createServiceToken<CacheLike>("owned-cache"),
      queue: createServiceToken<Queue>("owned-queue"),
    };
    const effects = createModelCacheInvalidationEffects([], modules, tokens, [Organization]);
    const app = createApplication({
      providers: [],
      services: [
        valueService(tokens.cache, cache),
        valueService(tokens.queue, new SyncQueue()),
        ...effects.services,
        ...createDatabaseBindings({
          default: "main",
          connections: { main: { driver: "sqlite", filename: ":memory:" } },
          models: [Organization],
          repositoryEffects: effects.repositoryEffects,
        }),
      ],
    });
    await app.start();
    try {
      await app.run(
        { kind: "command", actor: { kind: "system", policy: "fixture.class-cache" } },
        async (scope) => {
          const database = scope.resolve(DATABASE_SESSION_TOKEN);
          await database.execute({
            text: "CREATE TABLE organization (id INTEGER PRIMARY KEY)",
            params: [],
          });
          await cache.tags(CACHE_TAGS.organizations).remember("class-orgs", async () => []);
          await expect(
            database.transaction(async (tx) => {
              await tx.model(Organization).create({ id: 1 });
              throw new Error("rollback");
            }),
          ).rejects.toThrow("rollback");
          expect(await cache.get("class-orgs")).toEqual([]);
          await database.transaction(async (tx) => {
            await tx.model(Organization).create({ id: 2 });
            expect(await cache.get("class-orgs")).toEqual([]);
          });
          expect(await cache.get("class-orgs")).toBeUndefined();
        },
      );
    } finally {
      expect((await app.stop()).successful).toBe(true);
    }
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
