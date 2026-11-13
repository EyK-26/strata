import { expect, test } from "bun:test";
import { createModelCacheInvalidationListener } from "@getstrata/bootstrap/listeners/invalidateCacheOnModelWrite";
import { CacheRepository } from "@getstrata/core/cache/repository";
import { SimpleCache } from "@getstrata/core/cache/simpleCache";
import { SimpleCacheStore } from "@getstrata/core/cache/simpleCacheStore";
import { service } from "@getstrata/core/contracts/services";
import { createServiceToken } from "@getstrata/core/contracts/token";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import {
  type AfterCommitRepositoryListener,
  defineRepository,
  repositoryEffects,
  type TransactionalRepositoryListener,
} from "@getstrata/core/database/definitions";
import { defineTable } from "@getstrata/core/database/table";
import { withJsonErrorHandling } from "@getstrata/core/http/response";
import { sessionSql } from "../helpers/nativePersistenceApplication";
import { type OutboxFixture, withOutboxes } from "../helpers/outboxApplication";

type Organization = { id: number; name: string };
const organization = defineRepository({
  name: "cache.organizations",
  table: defineTable<Organization, "id">({
    name: "organization",
    primaryKey: "id",
    columns: ["id", "name"],
  }),
  dependencies: [] as const,
  create: (binding) => new BaseRepository(binding),
});
const intent =
  createServiceToken<TransactionalRepositoryListener<Organization, "id">>("test.cache.intent");
const observed =
  createServiceToken<AfterCommitRepositoryListener<Organization>>("test.cache.observed");
const cache = () => new CacheRepository(new SimpleCacheStore(new SimpleCache(60_000, 20)));
async function withCacheOutbox<T>(
  options: {
    cache: ReturnType<typeof cache>;
    hooks?: () => void;
    reject?: (row: Readonly<Organization>) => boolean;
    listeners?: boolean;
  },
  work: (fixture: OutboxFixture) => Promise<T>,
) {
  return withOutboxes(
    [
      {
        listeners:
          options.listeners === false ? [] : [createModelCacheInvalidationListener(options.cache)],
        retryDelayMs: 1,
      },
    ],
    async (fixture) => {
      await fixture.db.unsafe(
        "CREATE TABLE organization (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)",
      );
      return work(fixture);
    },
    {
      prepare: (bindings) => {
        const binding = bindings[0];
        if (!binding) throw Error("Missing coordinator declaration");
        return {
          repositories: [organization],
          repositoryEffects: [
            repositoryEffects(organization, [
              { action: "created", transactional: intent, afterCommit: observed },
            ]),
          ],
          services: [
            service(intent, {
              lifetime: "application",
              dependencies: [binding.token] as const,
              create: (outbox) => async (publication) => {
                if (options.reject?.(publication.row)) throw Error("Publication failure fixture");
                await outbox.publish(
                  publication.session,
                  "strata.cache.invalidate-tags",
                  { tags: ["organizations", "reports"] },
                  { tenantId: null },
                );
              },
            }),
            service(observed, {
              lifetime: "application",
              dependencies: [] as const,
              create: () => () => {
                options.hooks?.();
              },
            }),
          ],
        };
      },
    },
  );
}
test("real HTTP commit persists recovery before worker cache outage, rollback is atomic and later hooks still run", async () => {
  const store = cache();
  await store.tags("organizations").remember("list", async () => ["old"]);
  let unavailable = true;
  const unreliable = new Proxy(store, {
    get(target, key) {
      if (unavailable) throw Error("Fixture cache unavailable");
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  let hooks = 0;
  await withCacheOutbox(
    {
      cache: unreliable,
      hooks: () => {
        hooks++;
      },
    },
    async (fixture) => {
      const outbox = fixture.outboxes[0];
      if (!outbox) throw Error("Missing coordinator");
      const server = Bun.serve({
        port: 0,
        fetch: withJsonErrorHandling(async (request) =>
          fixture.transaction(async (selected) => {
            await selected.repository(organization).create({ name: "committed" });
            if (new URL(request.url).searchParams.has("fail"))
              throw Error("Injected business failure");
            return Response.json({ ok: true });
          }),
        ),
      });
      try {
        expect((await fetch(server.url)).status).toBe(200);
        expect(hooks).toBe(1);
        expect(
          (
            await fixture.db.unsafe<{ count: number }>(
              "SELECT COUNT(*) AS count FROM strata_outbox_delivery",
            )
          )[0]?.count,
        ).toBe(1);
        expect(await outbox.processNext()).toBe(true);
        expect((await fixture.delivery())[0]).toMatchObject({ status: "pending", attempts: 1 });
        expect(await store.get<string[]>("list")).toEqual(["old"]);
        expect((await fetch(new URL("/?fail", server.url))).status).toBe(500);
        expect(
          (
            await fixture.db.unsafe<{ count: number }>("SELECT COUNT(*) AS count FROM organization")
          )[0]?.count,
        ).toBe(1);
        expect(
          (
            await fixture.db.unsafe<{ count: number }>(
              "SELECT COUNT(*) AS count FROM strata_outbox_event",
            )
          )[0]?.count,
        ).toBe(1);
        expect(hooks).toBe(1);
        unavailable = false;
        await Bun.sleep(10);
        expect(await outbox.processNext()).toBe(true);
        expect(await store.get<string[]>("list")).toBeUndefined();
        expect((await fixture.delivery())[0]?.status).toBe("completed");
      } finally {
        await server.stop(true);
      }
    },
  );
});
test("missing listener and standalone or unrelated-connection writes fail before mutation", async () => {
  await withCacheOutbox({ cache: cache(), listeners: false }, async (fixture) => {
    await expect(
      fixture.transaction((selected) =>
        selected.repository(organization).create({ name: "missing" }),
      ),
    ).rejects.toThrow("No durable listeners");
    expect(await fixture.db.unsafe("SELECT * FROM organization")).toEqual([]);
  });
  await withCacheOutbox({ cache: cache() }, async (fixture) => {
    const outbox = fixture.outboxes[0];
    if (!outbox) throw Error("Missing coordinator");
    await fixture.run(async (selected) => {
      await expect(
        Promise.resolve().then(() =>
          outbox.publish(
            selected as never,
            "strata.cache.invalidate-tags",
            { tags: ["organizations"] },
            { tenantId: null },
          ),
        ),
      ).rejects.toThrow();
    });
    await withOutboxes([], async (unrelated) =>
      unrelated.transaction(async (selected) => {
        await expect(
          Promise.resolve().then(() =>
            outbox.publish(
              selected,
              "strata.cache.invalidate-tags",
              { tags: ["organizations"] },
              { tenantId: null },
            ),
          ),
        ).rejects.toThrow();
      }),
    );
    expect(await fixture.db.unsafe("SELECT * FROM organization")).toEqual([]);
  });
});
test("catching a failed cache publication cannot commit a row without its intent", async () => {
  await withCacheOutbox(
    { cache: cache(), reject: (row) => row.name === "must roll back" },
    async (fixture) => {
      await fixture.transaction(async (selected) => {
        await expect(
          selected.repository(organization).create({ name: "must roll back" }),
        ).rejects.toThrow("Publication failure fixture");
        expect(
          (
            await sessionSql(selected).unsafe<{ count: number }>(
              "SELECT COUNT(*) AS count FROM organization",
            )
          )[0]?.count,
        ).toBe(0);
        await selected.repository(organization).create({ name: "valid" });
      });
      expect(
        (
          await fixture.db.unsafe<{ count: number }>("SELECT COUNT(*) AS count FROM organization")
        )[0]?.count,
      ).toBe(1);
      expect(
        (
          await fixture.db.unsafe<{ count: number }>(
            "SELECT COUNT(*) AS count FROM strata_outbox_event",
          )
        )[0]?.count,
      ).toBe(1);
    },
  );
});
