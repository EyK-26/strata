import { describe, expect, test } from "bun:test";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { defineRepository } from "@getstrata/core/database/definitions";
import { defineModel, Model } from "@getstrata/core/database/model";
import { buildSelectQuery } from "@getstrata/core/database/query";
import { dialectFor } from "@getstrata/core/database/sqlDialects";
import { defineTable } from "@getstrata/core/database/table";
import { withBoundDatabase } from "../../helpers/boundRepositoryHarness";

const table = defineTable<{ id: number; stock: number }, "id">({
  name: "stock",
  primaryKey: "id",
  columns: ["id", "stock"],
});
class Stock extends Model<{ id: number; stock: number }, "id"> {}
const repositoryDefinition = defineRepository({
  name: "stock.repo",
  table,
  dependencies: [] as const,
  create: (binding) => new BaseRepository(binding),
});
const stockDefinition = defineModel({
  name: "Stock",
  repository: repositoryDefinition,
  dependencies: [] as const,
  attributes: {},
  construct: (state, binding) => new Stock(state, binding),
});
const definition = {
  default: "test",
  connections: { test: { driver: "sqlite" as const, filename: ":memory:" } },
  repositories: [repositoryDefinition],
  models: [stockDefinition],
};
describe("typed row locks", () => {
  test("compiles PostgreSQL locks after ordering/limit and keeps bindings", () =>
    ((dialect) => {
      const query = buildSelectQuery(dialect, table, {
        where: { id: 7 },
        orderBy: { column: "id" },
        limit: 1,
        lock: { mode: "update", of: ["stock"], wait: "skipLocked" },
      });
      expect(query.text).toEndWith(
        'ORDER BY "stock"."id" ASC LIMIT 1 FOR UPDATE OF "stock" SKIP LOCKED',
      );
      expect(query.params).toEqual([7]);
      expect(
        buildSelectQuery(dialect, table, { lock: { mode: "share", wait: "nowait" } }).text,
      ).toEndWith(" FOR SHARE NOWAIT");
    })(dialectFor("pgsql")));
  test("MySQL 8+ uses its supported lock modes without PG targets", () =>
    ((dialect) => {
      expect(buildSelectQuery(dialect, table, { lock: { mode: "update" } }).text).toEndWith(
        " FOR UPDATE",
      );
      expect(
        buildSelectQuery(dialect, table, {
          lock: { mode: "share", wait: "skipLocked" },
        }).text,
      ).toEndWith(" FOR SHARE SKIP LOCKED");
      expect(() =>
        buildSelectQuery(dialect, table, { lock: { mode: "update", of: ["stock"] } }),
      ).toThrow("only on PostgreSQL");
    })(dialectFor("mysql")));
  test("SQLite never silently discards locking", () =>
    ((dialect) => {
      expect(() => buildSelectQuery(dialect, table, { lock: { mode: "update" } })).toThrow(
        "not supported on SQLite",
      );
    })(dialectFor("sqlite")));
  test("invalid targets, modes, waits and grouped locks fail", () =>
    ((dialect) => {
      for (const of of [[], ["missing"], ["stock;DROP TABLE stock"]])
        expect(() => buildSelectQuery(dialect, table, { lock: { mode: "update", of } })).toThrow(
          "targets",
        );
      expect(() =>
        buildSelectQuery(dialect, table, { lock: JSON.parse('{"mode":"bad"}') }),
      ).toThrow("mode");
      expect(() =>
        buildSelectQuery(dialect, table, {
          lock: JSON.parse('{"mode":"update","wait":"bad"}'),
        }),
      ).toThrow("wait");
      expect(() =>
        buildSelectQuery(dialect, table, { groupBy: "id", lock: { mode: "update" } }),
      ).toThrow("aggregate");
    })(dialectFor("pgsql")));
  test("models preserve concrete query results and snapshot lock options", async () =>
    withBoundDatabase({ definition }, async (database) => {
      const bound = database.model(stockDefinition);
      const of = ["stock"];
      const query = bound.query().lockForUpdate({ of });
      of[0] = "bad";
      expect(query.query.getOptions().lock).toEqual({ mode: "update", of: ["stock"] });
      expect(bound.query().sharedLock().query.getOptions().lock?.mode).toBe("share");
      await expect(query.count()).rejects.toThrow("row selection");
      await expect(query.select("id").first()).rejects.toThrow();
    }));
  test("unlocked queries do not acquire a transaction or lock", () =>
    withBoundDatabase({ definition }, (database) => {
      expect(buildSelectQuery(database.dialect, table).text).not.toInclude(" FOR ");
      const repository = database.repository(repositoryDefinition);
      expect(repository.query().lockForUpdate().getOptions().lock?.mode).toBe("update");
    }));
});
