import { expect, test } from "bun:test";
import { runWithSqlDialect } from "@getstrata/core/database/dialect";
import { buildSelectQuery } from "@getstrata/core/database/query";
import { defineTable } from "@getstrata/core/database/table";
import type { KeysetCursor } from "@getstrata/core/pagination";
import { keysetBoundary } from "../../../src/core/database/keyset.ts";

const table = defineTable<{ id: number; stamp: string; tenant_id: number }, "id">({
  name: "seek_rows",
  primaryKey: "id",
  columns: ["id", "stamp", "tenant_id"],
});
const cursor: KeysetCursor = {
  version: 1,
  order: [
    { column: "stamp", direction: "desc" },
    { column: "id", direction: "desc" },
  ],
  values: ["2030-01-01 00:00:00.123456+00", "4"],
};
test("Postgres same-direction bounds become qualified, parameterized row comparisons", () =>
  runWithSqlDialect("pgsql", () => {
    for (const direction of ["asc", "desc"] as const) {
      const order = cursor.order.map((item) => ({ ...item, direction }));
      const result = buildSelectQuery(
        table,
        { where: { tenant_id: 7 } },
        keysetBoundary(order, { ...cursor, order }),
      );
      expect(result.text).toContain(
        `("seek_rows"."stamp", "seek_rows"."id") ${direction === "asc" ? ">" : "<"} ($2, $3)`,
      );
      expect(result.params).toEqual([7, ...cursor.values]);
    }
    const hostile = "' OR TRUE --";
    const result = buildSelectQuery(
      table,
      {},
      keysetBoundary(cursor.order, { ...cursor, values: [hostile, "4"] }),
    );
    expect(result.text).not.toContain(hostile);
    expect(result.params).toEqual([hostile, "4"]);
  }));
test("mixed directions, scalar bounds and other dialects retain their lexicographic path", () => {
  for (const driver of ["pgsql", "mysql", "sqlite"] as const)
    runWithSqlDialect(driver, () => {
      const mixed = [cursor.order[0]!, { column: "id", direction: "asc" as const }];
      expect(JSON.stringify(keysetBoundary(mixed, { ...cursor, order: mixed }))).toContain(
        '"group"',
      );
      const scalar = [cursor.order[1]!];
      expect(
        JSON.stringify(keysetBoundary(scalar, { ...cursor, order: scalar, values: ["4"] })),
      ).toContain('"where"');
      if (driver !== "pgsql")
        expect(JSON.stringify(keysetBoundary(cursor.order, cursor))).toContain('"group"');
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
      expect(() => buildSelectQuery(table, {}, [{ kind: "and", compareRow }] as never)).toThrow(
        "row comparison",
      );
  }));
