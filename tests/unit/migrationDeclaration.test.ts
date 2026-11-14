import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { runWithSqlDialect } from "@getstrata/core/database/dialect";
import { defineMigration } from "@getstrata/core/database/migrations/declaration";
import type { MigrationDatabase } from "@getstrata/core/database/migrations/types";

function fixture() {
  const sqlite = new Database(":memory:");
  const db: MigrationDatabase = {
    async unsafe<T = unknown>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
      return sqlite.query(sql).all(...(params as (string | number | null)[])) as T[];
    },
  };
  return { sqlite, db };
}

describe("declarative migrations", () => {
  test("executes SQLite schema plans, supplies raw access, and forwards reset context", async () => {
    const { sqlite, db } = fixture();
    let downContext: unknown;
    const migration = defineMigration({
      name: "products",
      async up(schema, selected) {
        expect(selected).toBe(db);
        schema.create("products", (table) => {
          table.id();
          table.string("title");
        });
        await selected.unsafe("CREATE TABLE migration_marker (value TEXT)");
        await selected.unsafe("INSERT INTO migration_marker VALUES (?)", ["raw"]);
      },
      async down(schema, selected, context) {
        expect(selected).toBe(db);
        downContext = context;
        schema.drop("products");
        await selected.unsafe("DROP TABLE migration_marker");
      },
    });
    try {
      await runWithSqlDialect("sqlite", () => migration.up(db));
      await db.unsafe("INSERT INTO products (title) VALUES (?)", ["Notebook"]);
      expect(await db.unsafe("SELECT title FROM products")).toEqual([{ title: "Notebook" }]);
      expect(await db.unsafe("SELECT value FROM migration_marker")).toEqual([{ value: "raw" }]);
      const context = { operation: "fresh" } as const;
      await runWithSqlDialect("sqlite", () => migration.down(db, context));
      expect(downContext).toBe(context);
      expect(
        await db.unsafe(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('products', 'migration_marker')",
        ),
      ).toEqual([]);
    } finally {
      sqlite.close();
    }
  });

  test("captures immutable callbacks and supports ordinary rollback without context", async () => {
    const { sqlite, db } = fixture();
    let called = 0;
    const declaration = {
      name: "original",
      up: () => {
        called++;
      },
      down: (_schema: unknown, _db: unknown, context: unknown = undefined) => {
        expect(context).toBeUndefined();
        called++;
      },
    };
    const migration = defineMigration(declaration);
    declaration.name = "changed";
    declaration.up = () => {
      throw new Error("replaced");
    };
    try {
      expect(Object.isFrozen(migration)).toBe(true);
      expect(migration.name).toBe("original");
      await runWithSqlDialect("sqlite", async () => {
        await migration.up(db);
        await migration.down(db);
      });
      expect(called).toBe(2);
    } finally {
      sqlite.close();
    }
  });

  test("does not execute a queued plan when its async callback fails", async () => {
    const { sqlite, db } = fixture();
    const failure = new Error("declaration failed");
    const migration = defineMigration({
      name: "failure",
      async up(schema) {
        schema.create("should_not_exist", (table) => {
          table.id();
        });
        await Promise.resolve();
        throw failure;
      },
      down() {},
    });
    try {
      await expect(runWithSqlDialect("sqlite", () => migration.up(db))).rejects.toBe(failure);
      expect(
        await db.unsafe("SELECT name FROM sqlite_master WHERE name = 'should_not_exist'"),
      ).toEqual([]);
    } finally {
      sqlite.close();
    }
  });

  test("propagates SQL failure without pretending earlier raw work was rolled back", async () => {
    const { sqlite, db } = fixture();
    const migration = defineMigration({
      name: "sql_failure",
      async up(schema, selected) {
        await selected.unsafe("CREATE TABLE retained_raw (id INTEGER)");
        schema.table("missing_table", (table) => {
          table.string("value");
        });
      },
      down() {},
    });
    try {
      await expect(runWithSqlDialect("sqlite", () => migration.up(db))).rejects.toThrow();
      expect(await db.unsafe("SELECT name FROM sqlite_master WHERE name = 'retained_raw'")).toEqual(
        [{ name: "retained_raw" }],
      );
    } finally {
      sqlite.close();
    }
  });

  test("rejects invalid declarations before executing callbacks", () => {
    for (const value of [
      { name: "", up() {}, down() {} },
      { name: "   ", up() {}, down() {} },
      { name: 42, up() {}, down() {} },
      { name: "missing_up", down() {} },
      { name: "missing_down", up() {} },
      { name: "bad_up", up: true, down() {} },
      { name: "bad_down", up() {}, down: "no" },
    ]) {
      // Exercise malformed JavaScript callers at the public boundary.
      expect(() => defineMigration(value as never)).toThrow(TypeError);
    }
  });
});
