import { expect, test } from "bun:test";
import { service } from "@getstrata/core/contracts/services";
import { createServiceToken } from "@getstrata/core/contracts/token";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import {
  type AfterCommitRepositoryListener,
  defineRepository,
  type TransactionalRepositoryListener,
} from "@getstrata/core/database/definitions";
import type { DatabaseSession } from "@getstrata/core/database/session";
import { defineTable } from "@getstrata/core/database/table";
import { UnprocessableEntityError } from "@getstrata/core/errors/http";
import { createConnection } from "mysql2/promise";
import {
  createNativePersistenceApplication,
  sessionSql,
} from "../helpers/nativePersistenceApplication";

type Row = { id: number; slug: string; quantity: number; deleted_at: Date | null };
type StringRow = { key_name: string; slug: string; quantity: number };
const stringsDefinition = defineRepository({
  name: "string.records",
  table: defineTable<StringRow, "key_name">({
    name: "string_records",
    primaryKey: "key_name",
    columns: ["key_name", "slug", "quantity"],
  }),
  dependencies: [] as const,
  create: (binding) => new BaseRepository(binding),
});
async function fixture(
  run: (
    repo: BaseRepository<Row, "id">,
    connection: ReturnType<typeof sessionSql>,
    databaseUrl: string,
    database: DatabaseSession,
    repository: ReturnType<typeof repositoryDefinition>,
  ) => Promise<void>,
  listeners?: {
    created: AfterCommitRepositoryListener<Row>;
    updated: TransactionalRepositoryListener<Row, "id">;
  },
) {
  const url = process.env.MYSQL_OBSERVABILITY_ADMIN_URL;
  if (!url) throw Error("MYSQL_OBSERVABILITY_ADMIN_URL required for MySQL ORM qualification.");
  const admin = await createConnection(url);
  const name = `repo_write_${crypto.randomUUID().replaceAll("-", "")}`;
  let native: Awaited<ReturnType<typeof createNativePersistenceApplication>> | undefined;
  try {
    await admin.query(`CREATE DATABASE ${name}`);
    const target = new URL(url);
    target.pathname = `/${name}`;
    const changed = new URL(target);
    changed.searchParams.set("flags", "-FOUND_ROWS");
    const created = createServiceToken<AfterCommitRepositoryListener<Row>>("records.created");
    const updated =
      createServiceToken<TransactionalRepositoryListener<Row, "id">>("records.updated");
    const repository = repositoryDefinition(
      listeners
        ? [
            { action: "created", afterCommit: created },
            { action: "updated", transactional: updated },
          ]
        : [],
    );
    native = await createNativePersistenceApplication(
      {
        default: "main",
        connections: {
          main: { driver: "mysql", url: target.href },
          changed: { driver: "mysql", url: changed.href },
          unrelated: { driver: "mysql", url: process.env.MYSQL_URL ?? target.href },
        },
        repositories: [repository, stringsDefinition],
      },
      undefined,
      listeners
        ? [
            service(created, {
              lifetime: "application",
              dependencies: [] as const,
              create: () => listeners.created,
            }),
            service(updated, {
              lifetime: "application",
              dependencies: [] as const,
              create: () => listeners.updated,
            }),
          ]
        : [],
    );
    await native.run(async (database) => {
      const db = sessionSql(database);
      await db.unsafe(
        "CREATE TABLE records (id INTEGER PRIMARY KEY AUTO_INCREMENT,slug VARCHAR(100) NOT NULL UNIQUE,quantity INTEGER NOT NULL DEFAULT 7,deleted_at DATETIME NULL) ENGINE=InnoDB",
      );
      await run(database.repository(repository), db, target.href, database, repository);
    });
  } finally {
    await native?.close();
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${name}`);
    } finally {
      await admin.end();
    }
  }
}
function repositoryDefinition(
  effects: readonly import("@getstrata/core/database/definitions").TypedRepositoryEffect<
    Row,
    "id"
  >[] = [],
) {
  return defineRepository({
    name: "records",
    table: defineTable<Row, "id">({
      name: "records",
      primaryKey: "id",
      columns: ["id", "slug", "quantity", "deleted_at"],
      softDeletes: true,
    }),
    dependencies: [] as const,
    effects,
    create: (binding) => new BaseRepository(binding),
  });
}

test("MySQL create returns stored generated keys/defaults for explicit and default repositories", async () =>
  fixture(async (repo, _db, _url, database, definition) => {
    const a = await repo.create({ slug: "first" });
    expect(a).toEqual({ id: 1, slug: "first", quantity: 7, deleted_at: null });
    const implicit = database.repository(definition);
    const rows = await Promise.all(
      Array.from({ length: 8 }, (_, i) => implicit.create({ slug: `concurrent-${i}` })),
    );
    expect(new Set(rows.map((row) => row.id)).size).toBe(8);
    for (const row of rows) expect(await implicit.findById(row.id)).toEqual(row);
    const explicit = await repo.create({ id: 80, slug: "explicit", quantity: 9 });
    expect(explicit).toEqual({ id: 80, slug: "explicit", quantity: 9, deleted_at: null });
  }));

test("MySQL ID writes return entities and honest absent/soft-delete outcomes", async () =>
  fixture(async (repo, db) => {
    await db.unsafe("INSERT INTO records (id,slug) VALUES (1,'fixture')");
    expect(await repo.updateById(1, { quantity: 7 })).toMatchObject({ id: 1, quantity: 7 });
    expect(await repo.updateById(999, { quantity: 3 })).toBeNull();
    expect(await repo.incrementById(1, "quantity", 2)).toMatchObject({ id: 1, quantity: 9 });
    expect(await repo.incrementById(999, "quantity")).toBeNull();
    expect(await repo.deleteById(1)).toBe(true);
    expect(await repo.deleteById(1)).toBe(false);
    expect(await repo.findById(1)).toBeNull();
    expect(await repo.updateById(1, { quantity: 1 })).toBeNull();
    expect(await repo.incrementById(1, "quantity")).toBeNull();
    expect(await repo.restoreById(1)).toMatchObject({ id: 1, quantity: 9, deleted_at: null });
    expect(await repo.restoreById(1)).toBeNull();
    expect(await repo.forceDeleteById(1)).toBe(true);
    expect(await repo.forceDeleteById(1)).toBe(false);
    expect(await repo.restoreById(999)).toBeNull();
  }));

test("MySQL upsert readback and set-write counts keep separate contracts", async () =>
  fixture(async (repo) => {
    expect(await repo.upsert({ slug: "upsert", quantity: 4 }, ["slug"])).toMatchObject({
      id: 1,
      quantity: 4,
    });
    expect(await repo.upsert({ slug: "upsert", quantity: 5 }, ["slug"])).toMatchObject({
      id: 1,
      quantity: 5,
    });
    expect(await repo.upsert({ slug: "upsert", quantity: 5 }, ["slug"])).toMatchObject({
      id: 1,
      quantity: 5,
    });
    expect(await repo.upsert({ slug: "upsert", quantity: 10 }, ["slug"], [])).toBeNull();
    expect(await repo.upsert({ slug: "upsert" }, ["slug"])).toBeNull();
    expect(await repo.upsert({ slug: "insert-only", quantity: 3 }, ["slug"], [])).toMatchObject({
      slug: "insert-only",
      quantity: 3,
    });
    expect(await repo.updateWhere({ quantity: 11 }, { where: { slug: "upsert" } })).toBe(1);
    expect(await repo.deleteWhere({ where: { slug: "absent" } })).toBe(0);
  }));

test("MySQL observers receive full rows and transactional failures roll back writes/events", async () => {
  const rows: unknown[] = [];
  let fail = false;
  await fixture(
    async (_repo, db, _url, database, definition) => {
      await database.transaction(async (transaction) => {
        const implicit = transaction.repository(definition);
        await implicit.create({ slug: "outer" });
        expect(rows).toHaveLength(0);
        await expect(
          transaction.transaction(async (child) => {
            await child.repository(definition).create({ slug: "nested" });
            throw Error("rollback nested");
          }),
        ).rejects.toThrow("rollback nested");
      });
      expect(rows).toEqual([{ id: 1, slug: "outer", quantity: 7, deleted_at: null }]);
      fail = true;
      await database.transaction(async (transaction) => {
        const implicit = transaction.repository(definition);
        await expect(implicit.updateById(1, { quantity: 88 })).rejects.toThrow(
          "publication failed",
        );
        expect(await implicit.findById(1)).toMatchObject({ quantity: 7 });
      });
      expect(await db.unsafe("SELECT slug,quantity FROM records")).toEqual([
        { slug: "outer", quantity: 7 },
      ]);
    },
    {
      created: (row) => {
        rows.push(row);
      },
      updated: () => {
        if (fail) throw new UnprocessableEntityError("publication failed");
      },
    },
  );
});

test("MySQL explicit roots keep callback locks and reject switching to another pool", async () =>
  fixture(async (repo, _db, _url, database, definition) => {
    if (!process.env.MYSQL_URL)
      throw Error("MYSQL_URL required for independent pool ownership probe.");
    await database.transaction(async (transaction) => {
      const scoped = transaction.repository(definition);
      const row = await scoped.create({ slug: "owned" });
      expect(await scoped.query().where({ id: row.id }).lockForUpdate().first()).toMatchObject({
        slug: "owned",
      });
      expect(await scoped.updateById(row.id, { quantity: 12 })).toMatchObject({ quantity: 12 });
      await expect(
        (async () =>
          database.connection("unrelated").repository(definition).create({ slug: "wrong-pool" }))(),
      ).rejects.toThrow("transaction scope is not active");
    });
    expect(await repo.findAll()).toMatchObject([{ slug: "owned", quantity: 12 }]);
  }));

test("MySQL string keys, database defaults, no-op upserts and zero auto IDs rehydrate stored values", async () =>
  fixture(async (repo, db, _url, database) => {
    await db.unsafe(
      "CREATE TABLE string_records (key_name VARCHAR(60) PRIMARY KEY, slug VARCHAR(60) NOT NULL UNIQUE, quantity INTEGER NOT NULL DEFAULT 4) ENGINE=InnoDB",
    );
    const strings = database.repository(stringsDefinition);
    expect(await strings.create({ key_name: "key-one", slug: "first" })).toEqual({
      key_name: "key-one",
      slug: "first",
      quantity: 4,
    });
    expect(
      await strings.upsert({ key_name: "key-one", slug: "first", quantity: 8 }, ["key_name"]),
    ).toEqual({ key_name: "key-one", slug: "first", quantity: 8 });
    expect(
      await strings.upsert({ key_name: "key-one", slug: "first" }, ["key_name"], []),
    ).toBeNull();
    expect(await strings.upsert({ key_name: "key-two", slug: "second" }, ["key_name"], [])).toEqual(
      { key_name: "key-two", slug: "second", quantity: 4 },
    );
    const zero = await repo.create({ id: 0, slug: "zero-auto" });
    expect(zero.id).toBeGreaterThan(0);
    expect(await repo.findById(zero.id)).toEqual(zero);
  }));

test("MySQL changed-row reporting retains no-op entities without reviving scoped-out rows", async () =>
  fixture(async (_repo, _db, _databaseUrl, database, definition) => {
    const selected = database.connection("changed");
    const changedRows = sessionSql(selected);
    const scoped = selected.repository(definition);
    const row = await scoped.create({ slug: "unchanged" });
    const [metadata] = await changedRows.unsafe<{ affectedRows: number }>(
      "UPDATE records SET quantity = quantity WHERE id = ?",
      [row.id],
    );
    expect(metadata?.affectedRows).toBe(0);
    expect(await scoped.updateById(row.id, { quantity: 7 })).toMatchObject({
      id: row.id,
      quantity: 7,
    });
    expect(await scoped.incrementById(row.id, "quantity", 0)).toMatchObject({
      id: row.id,
      quantity: 7,
    });
    expect(await scoped.updateById(999, { quantity: 7 })).toBeNull();
    expect(await scoped.incrementById(999, "quantity", 0)).toBeNull();
    expect(await scoped.softDeleteById(row.id)).toBe(true);
    expect(await scoped.softDeleteById(row.id)).toBe(false);
    expect(await scoped.updateById(row.id, { quantity: 7 })).toBeNull();
    expect(await scoped.incrementById(row.id, "quantity", 0)).toBeNull();
    expect(await scoped.restoreById(row.id)).toMatchObject({ id: row.id });
    expect(await scoped.restoreById(row.id)).toBeNull();
  }));
