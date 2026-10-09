import { expect, test } from "bun:test";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { runWithSqlDialect } from "@getstrata/core/database/dialect";
import { buildConditionalWriteQuery } from "@getstrata/core/database/query";
import { defineTable } from "@getstrata/core/database/table";
import { modelEventName } from "@getstrata/core/events";
import { eventBus } from "@getstrata/core/events/eventBus";

const table = defineTable<
  { id: number; owner: string; stock: number; deleted_at: Date | null },
  "id"
>({ name: "stock", primaryKey: "id", columns: ["id", "owner", "stock", "deleted_at"] });
test("conditional mutation binding and RETURNING across dialects", () => {
  for (const driver of ["pgsql", "sqlite", "mysql"] as const)
    runWithSqlDialect(driver, () => {
      const built = buildConditionalWriteQuery(
        table,
        "update",
        { stock: 9 },
        { where: { id: 1, owner: "old'; DROP TABLE stock;--" } },
      );
      expect(built.params).toEqual([9, 1, "old'; DROP TABLE stock;--"]);
      expect(built.text).not.toContain("DROP TABLE");
      expect(built.text.includes("RETURNING")).toBe(driver !== "mysql");
      if (driver === "pgsql") expect(built.text).toContain('"stock"."owner" = $3');
    });
});
test("empty predicates and unsupported selection options are rejected before mutation", async () => {
  let writes = 0;
  const repo = new BaseRepository(table, {
    async unsafe<T>(): Promise<T[]> {
      writes++;
      return [];
    },
  });
  await expect(repo.query().update({ stock: 2 })).rejects.toThrow("predicate");
  await expect(repo.query().where({}).delete()).rejects.toThrow("predicate");
  for (const options of [
    { limit: 1 },
    { orderBy: { column: "id" as const } },
    { lock: { mode: "update" as const } },
    { groupBy: "id" },
    { select: [] },
  ])
    await expect(repo.updateWhere({ stock: 2 }, { where: { id: 1 }, ...options })).rejects.toThrow(
      "do not support",
    );
  expect(writes).toBe(0);
  expect(() => buildConditionalWriteQuery(table, "update", {}, { where: { id: 1 } })).toThrow(
    "value",
  );
  for (const changes of [JSON.parse('{"id":2}'), JSON.parse('{"stock;DROP":2}')])
    expect(() =>
      buildConditionalWriteQuery(table, "update", changes, { where: { id: 1 } }),
    ).toThrow("non-primary");
  expect(() =>
    buildConditionalWriteQuery(table, "update", { stock: 2 }, { where: { id: 1 } }, []),
  ).toThrow("nonempty");
  runWithSqlDialect("mysql", () =>
    expect(() =>
      buildConditionalWriteQuery(table, "update", { stock: 2 }, { where: { id: 1 } }, ["stock"]),
    ).toThrow("not supported"),
  );
});
test("protected predicates survive OR, and deletes respect soft-deletion scopes", () => {
  const repo = new BaseRepository({ ...table, softDeletes: true });
  const options = repo
    .query()
    .where({ owner: "tenant-owner" })
    .protectWhere()
    .where({ id: 1 })
    .orWhere({ id: 2 })
    .getOptions();
  const query = buildConditionalWriteQuery(repo.getTable(), "delete", {}, options);
  expect(query.text).toStartWith('UPDATE "stock" SET "deleted_at" = $1');
  expect(query.text).toContain('"stock"."deleted_at" IS NULL');
  expect(query.params.slice(1)).toEqual(["tenant-owner", 1, 2]);
  expect(query.text).toContain("AND (");
  expect(buildConditionalWriteQuery(table, "delete", {}, { where: { id: 1 } }).text).toStartWith(
    "DELETE FROM",
  );
});
test("MySQL affectedRows metadata is used rather than result array length", async () => {
  await runWithSqlDialect("mysql", async () => {
    const repo = new BaseRepository(table, {
      async unsafe<T>(): Promise<T[]> {
        return JSON.parse('[{"affectedRows":0}]');
      },
    });
    expect(await repo.query().where({ owner: "stale" }).update({ stock: 2 })).toBe(0);
  });
});

test("bulk writes do not synthesize row observer or transactional-listener events", async () => {
  let calls = 0;
  const stop = eventBus.listen(modelEventName(table.name, "updated"), () => {
    calls++;
  });
  const stopTransactional = eventBus.listenTransactional(
    modelEventName(table.name, "updated"),
    () => {
      calls++;
    },
  );
  try {
    const repo = new BaseRepository(table, {
      async unsafe<T>(): Promise<T[]> {
        return JSON.parse('[{"id":1}]');
      },
    });
    expect(
      await runWithSqlDialect("pgsql", () => repo.query().where({ id: 1 }).update({ stock: 1 })),
    ).toBe(1);
    expect(calls).toBe(0);
  } finally {
    stop();
    stopTransactional();
  }
});
