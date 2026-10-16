import { expect, test } from "bun:test";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import {
  bindDatabaseConnection,
  getBoundDatabaseConnection,
  resetBoundDatabaseConnection,
} from "@getstrata/core/database/boundConnection";
import { resetSqlDialect, useSqlDialect } from "@getstrata/core/database/dialect";
import { createMysqlConnection } from "@getstrata/core/database/mysqlConnection";
import { defineTable } from "@getstrata/core/database/table";
import { runInTransaction } from "@getstrata/core/database/transaction";
import { UnprocessableEntityError } from "@getstrata/core/errors/http";
import { modelEventName } from "@getstrata/core/events";
import { eventBus } from "@getstrata/core/events/eventBus";
import { createConnection } from "mysql2/promise";

type Row = { id: number; slug: string; quantity: number; deleted_at: Date | null };
async function fixture(
  run: (
    repo: BaseRepository<Row, "id">,
    connection: ReturnType<typeof createMysqlConnection>,
  ) => Promise<void>,
) {
  const url = process.env.MYSQL_OBSERVABILITY_ADMIN_URL;
  if (!url) throw Error("MYSQL_OBSERVABILITY_ADMIN_URL required for MySQL ORM qualification.");
  const admin = await createConnection(url);
  const name = `repo_write_${crypto.randomUUID().replaceAll("-", "")}`;
  const previous = getBoundDatabaseConnection();
  let connection: ReturnType<typeof createMysqlConnection> | undefined;
  try {
    await admin.query(`CREATE DATABASE ${name}`);
    const target = new URL(url);
    target.pathname = `/${name}`;
    connection = createMysqlConnection(target.href);
    useSqlDialect("mysql");
    bindDatabaseConnection(connection);
    await connection.unsafe(
      "CREATE TABLE records (id INTEGER PRIMARY KEY AUTO_INCREMENT, slug VARCHAR(100) NOT NULL UNIQUE, quantity INTEGER NOT NULL DEFAULT 7, deleted_at DATETIME NULL) ENGINE=InnoDB",
    );
    const repo = new BaseRepository(
      defineTable<Row, "id">({
        name: "records",
        primaryKey: "id",
        columns: ["id", "slug", "quantity", "deleted_at"],
        softDeletes: true,
      }),
      connection,
    );
    await run(repo, connection);
  } finally {
    if (previous) bindDatabaseConnection(previous);
    else resetBoundDatabaseConnection();
    resetSqlDialect();
    try {
      await connection?.close();
    } finally {
      try {
        await admin.query(`DROP DATABASE IF EXISTS ${name}`);
      } finally {
        await admin.end();
      }
    }
  }
}

test("MySQL create returns stored generated keys/defaults for explicit and default repositories", async () =>
  fixture(async (repo) => {
    const a = await repo.create({ slug: "first" });
    expect(a).toEqual({ id: 1, slug: "first", quantity: 7, deleted_at: null });
    const implicit = new BaseRepository(repo.getTable());
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
    expect(await repo.upsert({ slug: "insert-only", quantity: 3 }, ["slug"], [])).toMatchObject({
      slug: "insert-only",
      quantity: 3,
    });
    expect(await repo.updateWhere({ quantity: 11 }, { where: { slug: "upsert" } })).toBe(1);
    expect(await repo.deleteWhere({ where: { slug: "absent" } })).toBe(0);
  }));

test("MySQL observers receive full rows and transactional failures roll back writes/events", async () =>
  fixture(async (repo, db) => {
    const rows: unknown[] = [];
    const off = eventBus.listen(modelEventName("records", "created"), (row) => {
      rows.push(row);
    });
    let fail: (() => void) | undefined;
    try {
      await runInTransaction(async () => {
        const implicit = new BaseRepository(repo.getTable());
        await implicit.create({ slug: "outer" });
        expect(rows).toHaveLength(0);
        await expect(
          runInTransaction(async () => {
            await implicit.create({ slug: "nested" });
            throw Error("rollback nested");
          }),
        ).rejects.toThrow("rollback nested");
      });
      expect(rows).toEqual([{ id: 1, slug: "outer", quantity: 7, deleted_at: null }]);
      fail = eventBus.listenTransactional(modelEventName("records", "updated"), () => {
        throw new UnprocessableEntityError("publication failed");
      });
      await runInTransaction(async () => {
        const implicit = new BaseRepository(repo.getTable());
        await expect(implicit.updateById(1, { quantity: 88 })).rejects.toThrow(
          "publication failed",
        );
        expect(await implicit.findById(1)).toMatchObject({ quantity: 7 });
      });
      expect(await db.unsafe("SELECT slug,quantity FROM records")).toEqual([
        { slug: "outer", quantity: 7 },
      ]);
    } finally {
      fail?.();
      off();
    }
  }));

test("MySQL explicit roots keep callback locks and reject switching to another pool", async () =>
  fixture(async (repo, db) => {
    const unrelatedUrl = process.env.MYSQL_URL;
    if (!unrelatedUrl) throw new Error("MYSQL_URL required for independent pool ownership probe.");
    const unrelated = createMysqlConnection(unrelatedUrl);
    try {
      resetBoundDatabaseConnection();
      await runInTransaction(
        async (tx) => {
          const scoped = repo.withConnection(tx);
          const row = await scoped.create({ slug: "owned" });
          expect(await scoped.query().where({ id: row.id }).lockForUpdate().first()).toMatchObject({
            slug: "owned",
          });
          expect(await repo.updateById(row.id, { quantity: 12 })).toMatchObject({ quantity: 12 });
          await expect(
            repo.withConnection(unrelated).create({ slug: "wrong-pool" }),
          ).rejects.toThrow("Cannot switch database connections");
        },
        { connection: db },
      );
      expect(await repo.findAll()).toMatchObject([{ slug: "owned", quantity: 12 }]);
    } finally {
      await unrelated.close();
    }
  }));

test("MySQL string keys, database defaults, no-op upserts and zero auto IDs rehydrate stored values", async () =>
  fixture(async (repo, db) => {
    await db.unsafe(
      "CREATE TABLE string_records (key_name VARCHAR(60) PRIMARY KEY, slug VARCHAR(60) NOT NULL UNIQUE, quantity INTEGER NOT NULL DEFAULT 4) ENGINE=InnoDB",
    );
    type StringRow = { key_name: string; slug: string; quantity: number };
    const strings = new BaseRepository(
      defineTable<StringRow, "key_name">({
        name: "string_records",
        primaryKey: "key_name",
        columns: ["key_name", "slug", "quantity"],
      }),
      db,
    );
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
