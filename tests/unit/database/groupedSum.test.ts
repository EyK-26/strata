import { expect, test } from "bun:test";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { runWithSqlDialect } from "@getstrata/core/database/dialect";
import { buildGroupedSumQuery } from "@getstrata/core/database/query";
import { hasMany } from "@getstrata/core/database/relationships";
import { createSqliteConnection } from "@getstrata/core/database/sqliteConnection";
import { defineTable } from "@getstrata/core/database/table";

type Line = {
  id: number;
  tenant_id: number;
  product_id: number | null;
  quantity: number | null;
  deleted_at: string | null;
};
const table = defineTable<Line, "id">({
  name: "lines",
  primaryKey: "id",
  columns: ["id", "tenant_id", "product_id", "quantity", "deleted_at"],
  softDeletes: true,
});

test("grouped sums bind predicates, validate columns and quote identifiers across dialects", () => {
  for (const driver of ["pgsql", "mysql", "sqlite"] as const)
    runWithSqlDialect(driver, () => {
      const built = buildGroupedSumQuery(table, "product_id", "quantity", {
        where: { deleted_at: "malicious'; DROP TABLE lines;--" },
      });
      const scoped = new BaseRepository(table)
        .query()
        .where({ tenant_id: 1 })
        .protectWhere()
        .where({ product_id: 11 })
        .orWhere({ tenant_id: 2 })
        .getOptions();
      expect(buildGroupedSumQuery(table, "product_id", "quantity", scoped).params).toEqual([
        1, 11, 2,
      ]);
      expect(built.params).toEqual(["malicious'; DROP TABLE lines;--"]);
      expect(built.text).not.toContain("DROP TABLE");
      expect(built.text).toContain("SUM(");
      expect(built.text).toContain("GROUP BY");
      expect(() =>
        buildGroupedSumQuery({ ...table, name: "lines;DROP" }, "product_id", "quantity"),
      ).toThrow("Invalid SQL identifier");
      expect(built.text).toContain(
        driver === "mysql" ? "AS CHAR" : driver === "pgsql" ? "::text" : "AS TEXT",
      );
      for (const column of ["unknown", "quantity); DROP TABLE lines;--"])
        expect(() =>
          buildGroupedSumQuery(table, JSON.parse(JSON.stringify(column)), "quantity"),
        ).toThrow("declared columns");
      expect(() => buildGroupedSumQuery(table, "product_id", JSON.parse('"unknown"'))).toThrow(
        "declared columns",
      );
    });
});
test("unsupported aggregate transformations and eager loading reject before SQL", async () => {
  let calls = 0;
  const repo = new BaseRepository(table, {
    async unsafe<T>(): Promise<T[]> {
      calls++;
      return [];
    },
  });
  for (const options of [
    { joins: [] },
    { select: [] },
    { groupBy: "product_id" },
    { having: {} },
    { orderBy: {} },
    { limit: 1 },
    { offset: 0 },
    { lock: { mode: "update" } },
  ])
    await expect(
      repo.sumBy("product_id", "quantity", JSON.parse(JSON.stringify(options))),
    ).rejects.toThrow("do not support");
  const relation = hasMany<Line, Line, "id", "product_id">({
    name: "children",
    localKey: "id",
    foreignKey: "product_id",
  });
  await expect(
    repo.query().withHasMany("children", relation, repo).sumBy("product_id", "quantity"),
  ).rejects.toThrow("eager loading");
  expect(calls).toBe(0);
});
test("native SQLite grouped sums preserve repeated groups, nulls, scope and exact integer text", async () => {
  const db = createSqliteConnection(":memory:");
  try {
    await runWithSqlDialect("sqlite", async () => {
      await db.unsafe(
        "CREATE TABLE lines (id INTEGER PRIMARY KEY,tenant_id INTEGER,product_id INTEGER,quantity INTEGER,deleted_at TEXT)",
      );
      await db.unsafe(
        "INSERT INTO lines VALUES (1,1,11,3,NULL),(2,1,11,4,NULL),(3,2,11,100,NULL),(4,1,11,100,'deleted'),(5,1,12,NULL,NULL),(6,1,NULL,9,NULL),(7,1,13,9007199254740992,NULL),(8,1,13,1,NULL)",
      );
      const repo = new BaseRepository(table, db);
      const rows = await repo.query().where({ tenant_id: 1 }).sumBy("product_id", "quantity");
      expect(new Map(rows.map((row) => [row.value, row.sum]))).toEqual(
        new Map([
          [null, "9"],
          [11, "7"],
          [12, null],
          [13, "9007199254740993"],
        ]),
      );
      expect(
        await repo
          .query()
          .where({ tenant_id: 1 })
          .protectWhere()
          .where({ product_id: 11 })
          .orWhere({ tenant_id: 2 })
          .sumBy("product_id", "quantity"),
      ).toEqual([{ value: 11, sum: "7" }]);
      expect(
        await repo
          .query()
          .where({ tenant_id: 1, product_id: 11 })
          .withTrashed()
          .sumBy("product_id", "quantity"),
      ).toEqual([{ value: 11, sum: "107" }]);
      expect(
        await repo
          .query()
          .where({ tenant_id: 1, product_id: 11 })
          .onlyTrashed()
          .sumBy("product_id", "quantity"),
      ).toEqual([{ value: 11, sum: "100" }]);
      expect(await repo.sumBy("product_id", "quantity", { where: { tenant_id: 999 } })).toEqual([]);
      await db.unsafe(
        "INSERT INTO lines VALUES (9,1,14,9223372036854775807,NULL),(10,1,14,1,NULL)",
      );
      await expect(
        repo.query().where({ product_id: 14 }).sumBy("product_id", "quantity"),
      ).rejects.toThrow();
    });
  } finally {
    db.close();
  }
});
