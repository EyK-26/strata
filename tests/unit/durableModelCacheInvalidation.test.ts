import { afterEach, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import {
  configureModulesDirectory,
  ensureModulesLoaded,
  resetDiscoverModulesForTests,
} from "@getstrata/bootstrap/discoverModules";
import {
  createModelCacheInvalidationListener,
  registerInvalidateCacheOnModelWriteListeners,
} from "@getstrata/bootstrap/listeners/invalidateCacheOnModelWrite";
import { CacheRepository } from "@getstrata/core/cache/repository";
import { SimpleCache } from "@getstrata/core/cache/simpleCache";
import { SimpleCacheStore } from "@getstrata/core/cache/simpleCacheStore";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import {
  bindDatabaseConnection,
  getBoundDatabaseConnection,
  resetBoundDatabaseConnection,
} from "@getstrata/core/database/boundConnection";
import { resetSqlDialect, useSqlDialect } from "@getstrata/core/database/dialect";
import { repositoryConnection as db } from "@getstrata/core/database/repositoryConnection";
import { createSqliteConnection } from "@getstrata/core/database/sqliteConnection";
import { defineTable } from "@getstrata/core/database/table";
import { runInTransaction } from "@getstrata/core/database/transaction";
import { eventBus } from "@getstrata/core/events";
import { createOutboxMigration, SqlOutbox } from "@getstrata/core/events/outbox";
import { withJsonErrorHandling } from "@getstrata/core/http/response";

let connection: ReturnType<typeof createSqliteConnection>;
let previous: ReturnType<typeof getBoundDatabaseConnection>;
let tenancy: string | undefined;
let dispose: (() => void) | undefined;
const repository = new BaseRepository(
  defineTable<{ id: number; name: string }, "id">({
    name: "organization",
    primaryKey: "id",
    columns: ["id", "name"],
  }),
);
beforeEach(async () => {
  previous = getBoundDatabaseConnection();
  tenancy = process.env.TENANCY_DRIVER;
  process.env.TENANCY_DRIVER = "none";
  connection = createSqliteConnection(":memory:");
  bindDatabaseConnection(connection);
  useSqlDialect("sqlite");
  await createOutboxMigration("fixture", "sqlite").up(connection);
  await connection.unsafe(
    "CREATE TABLE organization (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)",
  );
  resetDiscoverModulesForTests();
  configureModulesDirectory(join(import.meta.dir, "../fixtures/discover-modules"));
  await ensureModulesLoaded();
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  if (previous) bindDatabaseConnection(previous);
  else resetBoundDatabaseConnection();
  resetSqlDialect();
  if (tenancy === undefined) delete process.env.TENANCY_DRIVER;
  else process.env.TENANCY_DRIVER = tenancy;
  connection.close();
});
test("real HTTP commit persists recovery before worker cache outage, rollback is atomic and later hooks still run", async () => {
  const cache = new CacheRepository(new SimpleCacheStore(new SimpleCache(60_000, 20)));
  await cache.tags("organizations").remember("list", async () => ["old"]);
  let unavailable = true;
  const outbox = new SqlOutbox({
    listeners: [
      createModelCacheInvalidationListener(() => {
        if (unavailable) throw new Error("Fixture cache unavailable");
        return cache;
      }),
    ],
    retryDelayMs: 1,
  });
  registerInvalidateCacheOnModelWriteListeners();
  dispose = registerInvalidateCacheOnModelWriteListeners(eventBus, { outbox });
  // A generated provider calling again cannot put the old queue handoff back.
  registerInvalidateCacheOnModelWriteListeners();
  let hooks = 0;
  const stop = eventBus.listen("organization.created", () => {
    hooks++;
  });
  const handler = withJsonErrorHandling(async (request: Request) => {
    return runInTransaction(async () => {
      await repository.create({ name: "committed" });
      if (new URL(request.url).searchParams.has("fail"))
        throw new Error("Injected business failure");
      return Response.json({ ok: true });
    });
  });
  const server = Bun.serve({ port: 0, fetch: handler });
  try {
    expect((await fetch(`http://localhost:${server.port}/`)).status).toBe(200);
    expect(hooks).toBe(1);
    expect(
      (
        await db.unsafe<{ count: number }>("SELECT COUNT(*) AS count FROM strata_outbox_delivery")
      )[0]?.count,
    ).toBe(1);
    expect(await outbox.processNext()).toBe(true);
    expect(
      (await db.unsafe("SELECT status, attempts FROM strata_outbox_delivery"))[0],
    ).toMatchObject({ status: "pending", attempts: 1 });
    expect(await cache.get<string[]>("list")).toEqual(["old"]);
    expect((await fetch(`http://localhost:${server.port}/?fail`)).status).toBe(500);
    expect(
      (await db.unsafe<{ count: number }>("SELECT COUNT(*) AS count FROM organization"))[0]?.count,
    ).toBe(1);
    expect(
      (await db.unsafe<{ count: number }>("SELECT COUNT(*) AS count FROM strata_outbox_event"))[0]
        ?.count,
    ).toBe(1);
    expect(hooks).toBe(1);
    unavailable = false;
    await Bun.sleep(10);
    expect(await outbox.processNext()).toBe(true);
    expect(await cache.get<string[]>("list")).toBeUndefined();
    expect(
      (await db.unsafe<{ status: string }>("SELECT status FROM strata_outbox_delivery"))[0]?.status,
    ).toBe("completed");
  } finally {
    server.stop(true);
    stop();
  }
});
test("missing listener and standalone or unrelated-connection writes fail before mutation", async () => {
  expect(() =>
    registerInvalidateCacheOnModelWriteListeners(eventBus, {
      outbox: new SqlOutbox({ listeners: [] }),
    }),
  ).toThrow("must include");
  const cache = new CacheRepository(new SimpleCacheStore(new SimpleCache(60_000, 20)));
  const outbox = new SqlOutbox({ listeners: [createModelCacheInvalidationListener(() => cache)] });
  dispose = registerInvalidateCacheOnModelWriteListeners(eventBus, { outbox });
  await expect(repository.create({ name: "unsafe" })).rejects.toThrow("require runInTransaction");
  await expect(
    runInTransaction(() =>
      repository.withConnection(connection).create({ name: "wrong connection" }),
    ),
  ).rejects.toThrow("framework-bound");
  expect(
    (await db.unsafe<{ count: number }>("SELECT COUNT(*) AS count FROM organization"))[0]?.count,
  ).toBe(0);
});

test("catching a failed cache publication cannot commit a row without its intent", async () => {
  const cache = new CacheRepository(new SimpleCacheStore(new SimpleCache(60_000, 20)));
  const outbox = new SqlOutbox({ listeners: [createModelCacheInvalidationListener(() => cache)] });
  dispose = registerInvalidateCacheOnModelWriteListeners(eventBus, { outbox });
  const publish = outbox.publish.bind(outbox);
  outbox.publish = async () => {
    throw new Error("Publication failure fixture");
  };
  await runInTransaction(async () => {
    await expect(repository.create({ name: "must roll back" })).rejects.toThrow();
    expect(
      (await db.unsafe<{ count: number }>("SELECT COUNT(*) AS count FROM organization"))[0]?.count,
    ).toBe(0);
    outbox.publish = publish;
    await repository.create({ name: "valid" });
  });
  expect(
    (await db.unsafe<{ count: number }>("SELECT COUNT(*) AS count FROM organization"))[0]?.count,
  ).toBe(1);
  expect(
    (await db.unsafe<{ count: number }>("SELECT COUNT(*) AS count FROM strata_outbox_event"))[0]
      ?.count,
  ).toBe(1);
});
