import { expect, test } from "bun:test";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { defineRepository } from "@getstrata/core/database/definitions";
import { currentSqlDialect, runWithSqlDialect } from "@getstrata/core/database/dialect";
import { buildSelectQuery } from "@getstrata/core/database/query";
import { dialectFor } from "@getstrata/core/database/sqlDialects";
import { defineTable } from "@getstrata/core/database/table";
import type { KeysetCursor } from "@getstrata/core/pagination";
import { keysetBoundary } from "../../../src/core/database/keyset.ts";
import { withBoundDatabase } from "../../helpers/boundRepositoryHarness";

const table = defineTable<{ id: number; stamp: string; tenant_id: number }, "id">({
  name: "seek_rows",
  primaryKey: "id",
  columns: ["id", "stamp", "tenant_id"],
});
const seekOrder = [
  { column: "stamp", direction: "desc" },
  { column: "id", direction: "desc" },
] as const;
const cursor: KeysetCursor = {
  version: 1,
  order: [...seekOrder],
  values: ["2030-01-01 00:00:00.123456+00", "4"],
};
test("Postgres same-direction bounds become qualified, parameterized row comparisons", () =>
  runWithSqlDialect("pgsql", () => {
    for (const direction of ["asc", "desc"] as const) {
      const order = cursor.order.map((item) => ({ ...item, direction }));
      const result = buildSelectQuery(
        currentSqlDialect(),
        table,
        { where: { tenant_id: 7 } },
        keysetBoundary(currentSqlDialect(), order, { ...cursor, order }),
      );
      expect(result.text).toContain(
        `("seek_rows"."stamp", "seek_rows"."id") ${direction === "asc" ? ">" : "<"} ($2, $3)`,
      );
      expect(result.params).toEqual([7, ...cursor.values]);
    }
    const hostile = "' OR TRUE --";
    const result = buildSelectQuery(
      currentSqlDialect(),
      table,
      {},
      keysetBoundary(currentSqlDialect(), cursor.order, { ...cursor, values: [hostile, "4"] }),
    );
    expect(result.text).not.toContain(hostile);
    expect(result.params).toEqual([hostile, "4"]);
  }));
test("mixed directions, scalar bounds and other dialects retain their lexicographic path", () => {
  for (const driver of ["pgsql", "mysql", "sqlite"] as const)
    runWithSqlDialect(driver, () => {
      const mixed = [cursor.order[0]!, { column: "id", direction: "asc" as const }];
      expect(
        JSON.stringify(keysetBoundary(currentSqlDialect(), mixed, { ...cursor, order: mixed })),
      ).toContain('"group"');
      const scalar = [cursor.order[1]!];
      expect(
        JSON.stringify(
          keysetBoundary(currentSqlDialect(), scalar, { ...cursor, order: scalar, values: ["4"] }),
        ),
      ).toContain('"where"');
      if (driver !== "pgsql")
        expect(JSON.stringify(keysetBoundary(currentSqlDialect(), cursor.order, cursor))).toContain(
          '"group"',
        );
    });
});
test("malformed row comparisons fail before execution", () =>
  runWithSqlDialect("pgsql", () => {
    for (const compareRow of [
      { columns: [], values: [], operator: "lt" },
      { columns: ["id"], values: [], operator: "lt" },
      { columns: ["id"], values: [1], operator: "bad" },
      { columns: [""], values: [1], operator: "gt" },
      { columns: [null], values: [1], operator: "gt" },
      { columns: ["id"], values: null, operator: "gt" },
    ])
      expect(() =>
        buildSelectQuery(currentSqlDialect(), table, {}, [{ kind: "and", compareRow }] as never),
      ).toThrow("row comparison");
  }));

test("explicit dialects produce independent bounds in the same ambient scope", () => {
  const postgres = dialectFor("pgsql");
  const sqlite = dialectFor("sqlite");
  runWithSqlDialect("mysql", () => {
    expect(keysetBoundary(postgres, cursor.order, cursor)[0]).toHaveProperty("compareRow");
    expect(keysetBoundary(sqlite, cursor.order, cursor)[0]).toHaveProperty("group");
    expect(keysetBoundary(postgres, cursor.order, cursor)[0]).toHaveProperty("compareRow");
  });
});

test("bound SQLite repository retains lexicographic continuation SQL under an ambient Postgres dialect", async () => {
  const definition = defineRepository({
    name: "seek.repository",
    table,
    dependencies: [] as const,
    create: (binding) => new BaseRepository(binding),
  });
  const statements: { text: string; params: readonly unknown[] }[] = [];
  await withBoundDatabase(
    {
      definition: {
        default: "test",
        connections: { test: { driver: "sqlite", filename: ":memory:" } },
        repositories: [definition],
      },
      observe: (statement) => statements.push(statement),
    },
    async (database) => {
      await database.execute({
        text: "CREATE TABLE seek_rows (id INTEGER PRIMARY KEY, stamp TEXT, tenant_id INTEGER)",
        params: [],
      });
      await database.execute({
        text: "INSERT INTO seek_rows VALUES (5,'2030-01-02',7),(4,'2030-01-01',7),(3,'2030-01-01',7),(2,'2029-12-31',7),(1,'2029-12-30',8)",
        params: [],
      });
      const repo = database.repository(definition);
      const first = await repo
        .query()
        .where({ tenant_id: 7 })
        .keysetPaginate({ perPage: 2, orderBy: seekOrder });
      expect(first.data.map((row) => row.id)).toEqual([5, 4]);
      if (!first.meta.next_cursor) throw new Error("Expected continuation cursor");
      statements.length = 0;
      const continuation = first.meta.next_cursor;
      const second = await runWithSqlDialect("pgsql", () =>
        repo
          .query()
          .where({ tenant_id: 7 })
          .keysetPaginate({ perPage: 2, orderBy: seekOrder, cursor: continuation }),
      );
      expect(second.data.map((row) => row.id)).toEqual([3, 2]);
      const statement = statements.find((item) => item.text.startsWith("SELECT"));
      if (!statement) throw new Error("Expected observed repository continuation SQL");
      // SQLite's compiler must retain the scalar disjunction, including equality on the
      // timestamp tie, instead of borrowing Postgres's composite index-bound form.
      expect(statement.text).toContain('"seek_rows"."stamp" < ?');
      expect(statement.text).toContain('"seek_rows"."stamp" = ?');
      expect(statement.text).toContain('"seek_rows"."id" < ?');
      expect(statement.text).toContain(" OR ");
      expect(statement.text).not.toContain('("seek_rows"."stamp", "seek_rows"."id")');
      expect(statement.params.slice(0, 4)).toEqual([7, "2030-01-01", "2030-01-01", "4"]);
    },
  );
});
