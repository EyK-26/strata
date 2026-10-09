import { describe, expect, test } from "bun:test";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { runWithSqlDialect } from "@getstrata/core/database/dialect";
import { defineModel } from "@getstrata/core/database/model";
import { buildSelectQuery } from "@getstrata/core/database/query";
import { defineTable } from "@getstrata/core/database/table";

const table = defineTable<{ id: number; stock: number }, "id">({
  name: "stock",
  primaryKey: "id",
  columns: ["id", "stock"],
});
class Stock extends defineModel(table) {}
describe("typed row locks", () => {
  test("compiles PostgreSQL locks after ordering/limit and keeps bindings", () =>
    runWithSqlDialect("pgsql", () => {
      const query = buildSelectQuery(table, {
        where: { id: 7 },
        orderBy: { column: "id" },
        limit: 1,
        lock: { mode: "update", of: ["stock"], wait: "skipLocked" },
      });
      expect(query.text).toEndWith(
        'ORDER BY "stock"."id" ASC LIMIT 1 FOR UPDATE OF "stock" SKIP LOCKED',
      );
      expect(query.params).toEqual([7]);
      expect(buildSelectQuery(table, { lock: { mode: "share", wait: "nowait" } }).text).toEndWith(
        " FOR SHARE NOWAIT",
      );
    }));
  test("MySQL 8+ uses its supported lock modes without PG targets", () =>
    runWithSqlDialect("mysql", () => {
      expect(buildSelectQuery(table, { lock: { mode: "update" } }).text).toEndWith(" FOR UPDATE");
      expect(
        buildSelectQuery(table, { lock: { mode: "share", wait: "skipLocked" } }).text,
      ).toEndWith(" FOR SHARE SKIP LOCKED");
      expect(() => buildSelectQuery(table, { lock: { mode: "update", of: ["stock"] } })).toThrow(
        "only on PostgreSQL",
      );
    }));
  test("SQLite never silently discards locking", () =>
    runWithSqlDialect("sqlite", () => {
      expect(() => buildSelectQuery(table, { lock: { mode: "update" } })).toThrow(
        "not supported on SQLite",
      );
    }));
  test("invalid targets, modes, waits and grouped locks fail", () =>
    runWithSqlDialect("pgsql", () => {
      for (const of of [[], ["missing"], ["stock;DROP TABLE stock"]])
        expect(() => buildSelectQuery(table, { lock: { mode: "update", of } })).toThrow("targets");
      expect(() => buildSelectQuery(table, { lock: JSON.parse('{"mode":"bad"}') })).toThrow("mode");
      expect(() =>
        buildSelectQuery(table, { lock: JSON.parse('{"mode":"update","wait":"bad"}') }),
      ).toThrow("wait");
      expect(() => buildSelectQuery(table, { groupBy: "id", lock: { mode: "update" } })).toThrow(
        "aggregate",
      );
    }));
  test("models preserve concrete query results and snapshot lock options", async () => {
    const of = ["stock"];
    const query = Stock.query().lockForUpdate({ of });
    of[0] = "bad";
    expect(query.query.getOptions().lock).toEqual({ mode: "update", of: ["stock"] });
    expect(Stock.query().sharedLock().query.getOptions().lock?.mode).toBe("share");
    await expect(query.count()).rejects.toThrow("row selection");
    await expect(query.select("id").first()).rejects.toThrow();
  });
  test("unlocked queries do not acquire a transaction or lock", () => {
    expect(buildSelectQuery(table).text).not.toInclude(" FOR ");
    const repository = new BaseRepository(table);
    expect(repository.query().lockForUpdate().getOptions().lock?.mode).toBe("update");
  });
});
