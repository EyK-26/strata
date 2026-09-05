import { afterEach, describe, expect, test } from "bun:test";
import {
  type ActiveDatabaseHandle,
  getActiveDatabaseConnection,
  hasActiveDatabaseConnection,
} from "@getstrata/core/database/connectionContext";
import { currentSqlDialect } from "@getstrata/core/database/dialect";
import { createMysqlConnectionFromPool } from "@getstrata/core/database/mysqlConnection";
import {
  getNamedConnection,
  hasNamedConnection,
  registerNamedConnection,
  resetNamedConnections,
  runOnNamedConnection,
  unregisterNamedConnection,
} from "@getstrata/core/database/namedConnections";
import { createSqliteConnection } from "@getstrata/core/database/sqliteConnection";

describe("named database connections", () => {
  afterEach(() => {
    resetNamedConnections();
  });

  test("register, get, has, unregister, and reset", () => {
    expect(hasNamedConnection("kiosk")).toBe(false);
    expect(() => getNamedConnection("kiosk")).toThrow('Named database connection "kiosk"');
    expect(() => registerNamedConnection("  ", "sqlite", { unsafe: async () => [] })).toThrow(
      "non-empty name",
    );

    const handle = { unsafe: async <T>() => [] as T[] };
    registerNamedConnection("kiosk", "sqlite", handle);
    expect(hasNamedConnection("kiosk")).toBe(true);
    expect(getNamedConnection("kiosk").driver).toBe("sqlite");
    expect(unregisterNamedConnection("kiosk")).toBe(true);
    expect(hasNamedConnection("kiosk")).toBe(false);
    expect(unregisterNamedConnection("kiosk")).toBe(false);

    registerNamedConnection("kiosk", "sqlite", handle);
    resetNamedConnections();
    expect(hasNamedConnection("kiosk")).toBe(false);
  });

  test("runOnNamedConnection sets dialect and connection for async work", async () => {
    const sqlite = createSqliteConnection(":memory:");
    const fallback: ActiveDatabaseHandle = { unsafe: async () => [] };
    registerNamedConnection("kiosk", "sqlite", sqlite);
    const rows = await runOnNamedConnection("kiosk", async () => {
      await Promise.resolve();
      expect(currentSqlDialect().driver).toBe("sqlite");
      expect(hasActiveDatabaseConnection()).toBe(true);
      expect(getActiveDatabaseConnection(fallback)).toBe(sqlite);
      await sqlite.unsafe("CREATE TABLE kiosk_scorecards (id INTEGER PRIMARY KEY, notes TEXT)");
      await sqlite.unsafe("INSERT INTO kiosk_scorecards (notes) VALUES (?)", ["onsite"]);
      return sqlite.unsafe<{ id: number; notes: string }>("SELECT id, notes FROM kiosk_scorecards");
    });
    expect(rows).toEqual([{ id: 1, notes: "onsite" }]);
    expect(hasActiveDatabaseConnection()).toBe(false);
    expect(getActiveDatabaseConnection(fallback)).toBe(fallback);
    sqlite.close();
  });
});

describe("SQLite connection", () => {
  test("rejects an empty filename", () => {
    expect(() => createSqliteConnection("")).toThrow("SQLite path is not configured");
  });

  test("runs writes, RETURNING inserts, and selects", async () => {
    const sqlite = createSqliteConnection(":memory:");
    await sqlite.unsafe("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)");
    const inserted = await sqlite.unsafe<{ id: number; name: string }>(
      "INSERT INTO items (name) VALUES (?) RETURNING id, name",
      ["alpha"],
    );
    expect(inserted).toEqual([{ id: 1, name: "alpha" }]);
    const listed = await sqlite.unsafe<{ id: number; name: string }>("SELECT id, name FROM items");
    expect(listed).toEqual([{ id: 1, name: "alpha" }]);
    expect(await sqlite.unsafe("PRAGMA foreign_keys")).toEqual([{ foreign_keys: 1 }]);
    expect((await sqlite.unsafe("EXPLAIN SELECT id FROM items")).length).toBeGreaterThan(0);
    await sqlite.unsafe("WITH named AS (SELECT id, name FROM items) SELECT name FROM named");
    sqlite.close();
  });
});

describe("MySQL connection adapter", () => {
  test("createMysqlConnection requires a url", async () => {
    const { createMysqlConnection } = await import("@getstrata/core/database/mysqlConnection");
    expect(() => createMysqlConnection("")).toThrow("MYSQL_URL is not configured");
    const pooled = createMysqlConnection("mysql://hiroapp:hiroapp@127.0.0.1:1/unused");
    expect(typeof pooled.unsafe).toBe("function");
    await pooled.close();
  });

  test("maps row arrays, header objects, and empty results", async () => {
    const rows = createMysqlConnectionFromPool({
      execute: async () => [[{ id: 7 }], []],
    });
    expect(await rows.unsafe("SELECT 1")).toEqual([{ id: 7 }]);

    const header = createMysqlConnectionFromPool({
      execute: async () => [{ insertId: 4, affectedRows: 1 }, []],
      end: async () => undefined,
    });
    expect(await header.unsafe("INSERT INTO x VALUES (?)", [1])).toEqual([
      { insertId: 4, affectedRows: 1 },
    ]);
    await header.close();

    const empty = createMysqlConnectionFromPool({
      execute: async () => [null, []],
    });
    expect(await empty.unsafe("DO 0")).toEqual([]);
    await empty.close();
  });
});
