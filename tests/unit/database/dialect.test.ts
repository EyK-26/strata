import { describe, expect, test } from "bun:test";
import {
  currentSqlDialect,
  dialectFor,
  resetSqlDialect,
  runWithSqlDialect,
  useSqlDialect,
} from "@getstrata/core/database/dialect";
import {
  buildDeleteByIdQuery,
  buildInsertQuery,
  buildSelectQuery,
} from "@getstrata/core/database/query";
import { defineTable } from "@getstrata/core/database/table";
import { restoreEnvVar } from "../../helpers/restoreEnv";

type Seat = { id: number; name: string };

const seatTable = defineTable<Seat, "id">({
  name: "seats",
  primaryKey: "id",
  columns: ["id", "name"],
});

describe("SQL dialect", () => {
  test("PostgreSQL uses numbered placeholders, double quotes, and ILIKE", () => {
    runWithSqlDialect("pgsql", () => {
      const dialect = currentSqlDialect();
      expect(dialect.driver).toBe("pgsql");
      expect(dialect.placeholder(1)).toBe("$1");
      expect(dialect.quoteIdentifier("users")).toBe('"users"');
      expect(dialect.ilikeOperator()).toBe("ILIKE");
      expect(dialect.nowExpression()).toBe("NOW()");
      expect(dialect.returningClause("id")).toBe(" RETURNING id");
      expect(dialect.nullsLastSuffix()).toBe(" NULLS LAST");
      expect(dialect.castToText("$1")).toBe("$1::text");

      const insert = buildInsertQuery(seatTable, { name: "Backend" });
      expect(insert.text).toContain('INSERT INTO "seats"');
      expect(insert.text).toContain("$1");
      expect(insert.text).toContain("RETURNING");
    });
  });

  test("MySQL uses question marks, backticks, and LIKE without RETURNING", () => {
    runWithSqlDialect("mysql", () => {
      const dialect = currentSqlDialect();
      expect(dialect.placeholder(3)).toBe("?");
      expect(dialect.quoteIdentifier("users")).toBe("`users`");
      expect(dialect.ilikeOperator()).toBe("LIKE");
      expect(dialect.nowExpression()).toBe("CURRENT_TIMESTAMP");
      expect(dialect.returningClause("id")).toBe("");
      expect(dialect.nullsLastSuffix()).toBe("");
      expect(dialect.castToText("?")).toBe("CAST(? AS CHAR)");

      const insert = buildInsertQuery(seatTable, { name: "Backend" });
      expect(insert.text).toContain("INSERT INTO `seats`");
      expect(insert.text).toContain("?");
      expect(insert.text).not.toContain("RETURNING");

      const select = buildSelectQuery(seatTable, { where: { name: { ilike: "%eng%" } } });
      expect(select.text).toContain("LIKE ?");

      const del = buildDeleteByIdQuery(seatTable, 9);
      expect(del.text).toContain("DELETE FROM `seats`");
      expect(del.text).not.toContain("RETURNING");
      expect(del.params).toEqual([9]);
    });
  });

  test("SQLite uses question marks, double quotes, LIKE, and RETURNING", () => {
    runWithSqlDialect("sqlite", () => {
      const dialect = currentSqlDialect();
      expect(dialect.placeholder(1)).toBe("?");
      expect(dialect.quoteIdentifier("users")).toBe('"users"');
      expect(dialect.ilikeOperator()).toBe("LIKE");
      expect(dialect.nowExpression()).toBe("CURRENT_TIMESTAMP");
      expect(dialect.returningClause("id")).toBe(" RETURNING id");
      expect(dialect.nullsLastSuffix()).toBe("");

      expect(dialect.castToText("?")).toBe("CAST(? AS TEXT)");

      const insert = buildInsertQuery(seatTable, { name: "Design" });
      expect(insert.text).toContain("RETURNING");
      expect(insert.params).toEqual(["Design"]);
    });
  });

  test("rejects unsafe identifiers on every dialect", () => {
    for (const driver of ["pgsql", "mysql", "sqlite"] as const) {
      runWithSqlDialect(driver, () => {
        expect(() => currentSqlDialect().quoteIdentifier("users;drop")).toThrow(
          "Invalid SQL identifier",
        );
      });
    }
  });

  test("useSqlDialect and resetSqlDialect restore the env-selected dialect", () => {
    const previous = process.env.DB_CONNECTION;
    process.env.DB_CONNECTION = "pgsql";
    try {
      resetSqlDialect();
      expect(currentSqlDialect().driver).toBe("pgsql");
      useSqlDialect("mysql");
      expect(currentSqlDialect().driver).toBe("mysql");
      resetSqlDialect();
      expect(currentSqlDialect().driver).toBe("pgsql");
    } finally {
      restoreEnvVar("DB_CONNECTION", previous);
      resetSqlDialect();
    }
  });

  test("nested runWithSqlDialect restores the outer dialect", () => {
    runWithSqlDialect("pgsql", () => {
      runWithSqlDialect("sqlite", () => {
        expect(currentSqlDialect().driver).toBe("sqlite");
      });
      expect(currentSqlDialect().driver).toBe("pgsql");
    });
  });

  test("dialectFor returns the named dialect without changing the process default", () => {
    resetSqlDialect();
    const before = currentSqlDialect().driver;
    expect(dialectFor("pgsql").placeholder(2)).toBe("$2");
    expect(dialectFor("mysql").driver).toBe("mysql");
    expect(dialectFor("sqlite").castToText("x")).toBe("CAST(x AS TEXT)");
    expect(currentSqlDialect().driver).toBe(before);
  });

  test("full-text search is refused off PostgreSQL", () => {
    runWithSqlDialect("mysql", () => {
      expect(() =>
        buildSelectQuery(seatTable, {
          where: { name: { tsMatch: "backend" } } as never,
        }),
      ).toThrow("Full-text search (tsMatch) is only available on PostgreSQL.");
    });
  });
});
