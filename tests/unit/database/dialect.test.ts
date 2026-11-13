import { describe, expect, test } from "bun:test";
import { currentSqlDialect, dialectFor, runWithSqlDialect } from "@getstrata/core/database/dialect";
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

      const insert = buildInsertQuery(currentSqlDialect(), seatTable, { name: "Backend" });
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

      const insert = buildInsertQuery(currentSqlDialect(), seatTable, { name: "Backend" });
      expect(insert.text).toContain("INSERT INTO `seats`");
      expect(insert.text).toContain("?");
      expect(insert.text).not.toContain("RETURNING");

      const select = buildSelectQuery(currentSqlDialect(), seatTable, {
        where: { name: { ilike: "%eng%" } },
      });
      expect(select.text).toContain("LIKE ?");

      const del = buildDeleteByIdQuery(currentSqlDialect(), seatTable, 9);
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
      expect(dialect.nowExpression()).toBe("strftime('%Y-%m-%dT%H:%M:%fZ', 'now')");
      expect(dialect.returningClause("id")).toBe(" RETURNING id");
      expect(dialect.nullsLastSuffix()).toBe("");

      expect(dialect.castToText("?")).toBe("CAST(? AS TEXT)");

      const insert = buildInsertQuery(currentSqlDialect(), seatTable, { name: "Design" });
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

  test("missing context rejects ambient environment selection", () => {
    const previous = process.env.DB_CONNECTION;
    process.env.DB_CONNECTION = "mysql";
    try {
      expect(() => currentSqlDialect()).toThrow("SQL dialect context is required");
    } finally {
      restoreEnvVar("DB_CONNECTION", previous);
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

  test("dialectFor is explicit and does not establish a context", () => {
    expect(dialectFor("pgsql").placeholder(2)).toBe("$2");
    expect(dialectFor("mysql").driver).toBe("mysql");
    expect(dialectFor("sqlite").castToText("x")).toBe("CAST(x AS TEXT)");
    expect(() => currentSqlDialect()).toThrow("SQL dialect context is required");
  });

  test("concurrent contexts retain dialects across interleaved awaits and restore on failure", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const postgres = runWithSqlDialect("pgsql", async () => {
      await gate;
      expect(currentSqlDialect().driver).toBe("pgsql");
      expect(currentSqlDialect().placeholder(1)).toBe("$1");
      throw new Error("owned failure");
    });
    const mysql = runWithSqlDialect("mysql", async () => {
      expect(currentSqlDialect().driver).toBe("mysql");
      release();
      await Promise.resolve();
      expect(currentSqlDialect().driver).toBe("mysql");
      await runWithSqlDialect("sqlite", async () => {
        await Promise.resolve();
        expect(currentSqlDialect().driver).toBe("sqlite");
      });
      expect(currentSqlDialect().driver).toBe("mysql");
    });
    const outcomes = await Promise.allSettled([postgres, mysql]);
    expect(outcomes[0]).toMatchObject({ status: "rejected", reason: new Error("owned failure") });
    expect(outcomes[1]).toEqual({ status: "fulfilled", value: undefined });
    expect(() => currentSqlDialect()).toThrow("SQL dialect context is required");
  });

  test("full-text search is refused off PostgreSQL", () => {
    runWithSqlDialect("mysql", () => {
      expect(() =>
        buildSelectQuery(currentSqlDialect(), seatTable, {
          where: { name: { tsMatch: "backend" } } as never,
        }),
      ).toThrow("Full-text search (tsMatch) is only available on PostgreSQL.");
    });
  });
});
