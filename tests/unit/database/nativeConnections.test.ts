import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createMysqlConnectionFromPool,
  resetMysqlLoaderForTests,
} from "@getstrata/core/database/mysqlConnection";

import { createSqliteConnection } from "@getstrata/core/database/sqliteConnection";

type MysqlCorePool = {
  config: { connectionConfig: { timezone?: string } };
  listenerCount(event: string): number;
  emit(event: string, ...args: unknown[]): boolean;
};

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

describe("SQLite connection pragmas", () => {
  test("file databases use WAL with a busy timeout; memory databases keep the default journal", async () => {
    const directory = await mkdtemp(join(tmpdir(), "strata-sqlite-pragma-"));
    const file = createSqliteConnection(join(directory, "app.sqlite"));
    try {
      const [journal] = await file.unsafe<{ journal_mode: string }>("PRAGMA journal_mode");
      const [busy] = await file.unsafe<{ timeout: number }>("PRAGMA busy_timeout");
      const [sync] = await file.unsafe<{ synchronous: number }>("PRAGMA synchronous");
      const [foreignKeys] = await file.unsafe<{ foreign_keys: number }>("PRAGMA foreign_keys");
      expect(journal?.journal_mode).toBe("wal");
      expect(busy?.timeout).toBe(5000);
      expect(sync?.synchronous).toBe(1);
      expect(foreignKeys?.foreign_keys).toBe(1);
    } finally {
      await file.close();
      await rm(directory, { recursive: true, force: true });
    }

    const memory = createSqliteConnection(":memory:");
    try {
      const [journal] = await memory.unsafe<{ journal_mode: string }>("PRAGMA journal_mode");
      const [busy] = await memory.unsafe<{ timeout: number }>("PRAGMA busy_timeout");
      expect(journal?.journal_mode).toBe("memory");
      expect(busy?.timeout).toBe(5000);
    } finally {
      await memory.close();
    }
  });
});

describe("MySQL connection adapter", () => {
  afterEach(() => {
    resetMysqlLoaderForTests();
  });

  test("createMysqlConnection requires a url", async () => {
    const { createMysqlConnection } = await import("@getstrata/core/database/mysqlConnection");
    expect(() => createMysqlConnection("")).toThrow("MYSQL_URL is not configured");
    const pooled = createMysqlConnection("mysql://hiroapp:hiroapp@127.0.0.1:1/unused");
    expect(typeof pooled.unsafe).toBe("function");
    await pooled.close();
  });

  test("pool reads and writes DATETIME as UTC and pins the session time zone", async () => {
    const { createMysqlPool } = await import("@getstrata/core/database/mysqlConnection");
    const pool = await createMysqlPool("mysql://hiroapp:hiroapp@127.0.0.1:1/unused");
    const core = (pool as unknown as { pool: MysqlCorePool }).pool;
    try {
      expect(core.config.connectionConfig.timezone).toBe("Z");
      expect(core.listenerCount("connection")).toBe(1);

      const sent: string[] = [];
      core.emit("connection", {
        query(sql: string, callback: (error: unknown) => void) {
          sent.push(sql);
          callback(null);
        },
      });
      expect(sent).toEqual(["SET time_zone = '+00:00'"]);
    } finally {
      await pool.end();
    }
  });

  test("warns instead of throwing when the session time zone cannot be set", async () => {
    const { createMysqlPool } = await import("@getstrata/core/database/mysqlConnection");
    const pool = await createMysqlPool("mysql://hiroapp:hiroapp@127.0.0.1:1/unused");
    const core = (pool as unknown as { pool: MysqlCorePool }).pool;
    const warn = spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      core.emit("connection", {
        query(_sql: string, callback: (error: unknown) => void) {
          callback(new Error("SET not allowed"));
        },
      });
      core.emit("connection", {
        query(_sql: string, callback: (error: unknown) => void) {
          callback("denied");
        },
      });
      const messages = warn.mock.calls.map((call) => String(call[0]));
      expect(messages).toHaveLength(2);
      expect(messages).toEqual([
        "[mysql] Could not set the session time zone to UTC; DATETIME comparisons may drift.",
        "[mysql] Could not set the session time zone to UTC; DATETIME comparisons may drift.",
      ]);
      expect(messages.join(" ")).not.toContain("SET not allowed");
      expect(messages.join(" ")).not.toContain("denied");
    } finally {
      warn.mockRestore();
      await pool.end();
    }
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

  test("lazy connection loads mysql2 on the first query and closes the pool", async () => {
    let ended = 0;
    resetMysqlLoaderForTests(async () => ({
      createPool() {
        return {
          async execute() {
            return [[{ id: 1 }]];
          },
          async end() {
            ended += 1;
          },
          on() {},
        };
      },
    }));
    const { createMysqlConnection } = await import("@getstrata/core/database/mysqlConnection");
    const connection = createMysqlConnection("mysql://hiroapp:hiroapp@127.0.0.1:1/unused");
    await connection.close();
    expect(ended).toBe(0);

    expect(await connection.unsafe("SELECT 1")).toEqual([{ id: 1 }]);
    expect(await connection.unsafe("SELECT 1")).toEqual([{ id: 1 }]);
    await connection.close();
    expect(ended).toBe(1);
  });

  test("concurrent first queries share one pool and close() ends exactly that pool", async () => {
    let created = 0;
    let ended = 0;
    resetMysqlLoaderForTests(async () => ({
      createPool() {
        created += 1;
        return {
          async execute() {
            return [[{ ok: 1 }]];
          },
          async end() {
            ended += 1;
          },
          on() {},
        };
      },
    }));
    const { createMysqlConnection } = await import("@getstrata/core/database/mysqlConnection");
    const connection = createMysqlConnection("mysql://hiroapp:hiroapp@127.0.0.1:1/unused");

    await Promise.all([
      connection.unsafe("SELECT 1"),
      connection.unsafe("SELECT 2"),
      connection.unsafe("SELECT 3"),
    ]);
    expect(created).toBe(1);

    await connection.close();
    expect(ended).toBe(1);

    // A query after close opens a fresh pool instead of reusing the ended one.
    expect(await connection.unsafe("SELECT 4")).toEqual([{ ok: 1 }]);
    expect(created).toBe(2);
    await connection.close();
    expect(ended).toBe(2);
  });

  test("a failed pool load is retried on the next query", async () => {
    let attempts = 0;
    resetMysqlLoaderForTests(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("Cannot find module 'mysql2/promise'");
      }
      return {
        createPool() {
          return {
            async execute() {
              return [[{ ok: 1 }]];
            },
            async end() {},
            on() {},
          };
        },
      };
    });
    const { createMysqlConnection } = await import("@getstrata/core/database/mysqlConnection");
    const connection = createMysqlConnection("mysql://hiroapp:hiroapp@127.0.0.1:1/unused");

    await expect(connection.unsafe("SELECT 1")).rejects.toThrow(/Install mysql2/);
    await connection.close();
    expect(await connection.unsafe("SELECT 1")).toEqual([{ ok: 1 }]);
    expect(attempts).toBe(2);
    await connection.close();
  });

  test("close() while the first load is still failing does not throw", async () => {
    resetMysqlLoaderForTests(
      () => new Promise((_, reject) => setTimeout(() => reject(new Error("offline")), 10)),
    );
    const { createMysqlConnection } = await import("@getstrata/core/database/mysqlConnection");
    const connection = createMysqlConnection("mysql://hiroapp:hiroapp@127.0.0.1:1/unused");

    const query = connection.unsafe("SELECT 1");
    await connection.close();
    await expect(query).rejects.toThrow(/Install mysql2/);
  });

  test("createMysqlPool accepts mysql2's default export", async () => {
    resetMysqlLoaderForTests(async () => ({
      default: {
        createPool(config: { uri: string; timezone: string }) {
          expect(config.timezone).toBe("Z");
          return {
            async execute() {
              return [[]];
            },
            async end() {},
            on() {},
          };
        },
      },
    }));
    const { createMysqlPool } = await import("@getstrata/core/database/mysqlConnection");
    const first = createMysqlPool("mysql://hiroapp:hiroapp@127.0.0.1:1/unused");
    const second = createMysqlPool("mysql://hiroapp:hiroapp@127.0.0.1:1/unused");
    const [pool] = await Promise.all([first, second]);
    const cached = await createMysqlPool("mysql://hiroapp:hiroapp@127.0.0.1:1/unused");
    await pool.end();
    await cached.end();
  });

  test("createMysqlPool wraps a missing mysql2 import", async () => {
    resetMysqlLoaderForTests(async () => {
      throw new Error("Cannot find package 'mysql2'");
    });
    const { createMysqlPool } = await import("@getstrata/core/database/mysqlConnection");
    await expect(createMysqlPool("mysql://hiroapp:hiroapp@127.0.0.1:1/unused")).rejects.toThrow(
      "Install mysql2 to open a MySQL connection (`bun add mysql2`).",
    );
  });

  test("createMysqlPool rejects a mysql2 module without createPool", async () => {
    resetMysqlLoaderForTests(async () => ({}));
    const { createMysqlPool } = await import("@getstrata/core/database/mysqlConnection");
    await expect(createMysqlPool("mysql://hiroapp:hiroapp@127.0.0.1:1/unused")).rejects.toThrow(
      "mysql2/promise did not export createPool.",
    );
  });
});
