import { expect, test } from "bun:test";
import { createDatabaseBindings } from "@getstrata/core/database/bindings";
import { createSqliteConnection } from "@getstrata/core/database/sqliteConnection";
import { DATABASE_SESSION_TOKEN } from "@getstrata/core/database/tokens";
import { createApplication } from "@getstrata/core/runtime/application";

type Execute = (sql: string, params?: readonly unknown[]) => Promise<readonly unknown[]>;
type Adapter = "connection" | "application";
async function withDatabase(adapter: Adapter, work: (execute: Execute) => Promise<void>) {
  if (adapter === "connection") {
    const db = createSqliteConnection(":memory:");
    try {
      await work((sql, params) => db.unsafe(sql, params));
    } finally {
      db.close();
    }
    return;
  }
  const app = createApplication({
    providers: [],
    services: createDatabaseBindings({
      default: "main",
      connections: { main: { driver: "sqlite", filename: ":memory:" } },
    }),
  });
  await app.start();
  try {
    await app.run(async (scope) => {
      const db = scope.resolve(DATABASE_SESSION_TOKEN);
      await work((text, params = []) => db.execute({ text, params }));
    });
  } finally {
    await app.stop();
  }
}

for (const adapter of ["connection", "application"] as const) {
  test.each([
    "",
    "-- trace\n",
    "/* trace */ ",
    " \n/* SELECT ignored */ -- trace\r\n/* second */\t",
  ])(`${adapter} returns native results after SQL prefix %j`, async (prefix) => {
    await withDatabase(adapter, async (execute) => {
      expect(await execute(`${prefix}SELECT ? AS value`, [42])).toEqual([{ value: 42 }]);
      expect(await execute(`${prefix}SELECT '-- literal /* intact */' AS value`)).toEqual([
        { value: "-- literal /* intact */" },
      ]);
      expect(
        await execute(`${prefix}WITH item AS (SELECT ? AS value) SELECT value FROM item`, [7]),
      ).toEqual([{ value: 7 }]);
      expect(await execute(`${prefix}VALUES (?)`, [9])).toEqual([{ column1: 9 }]);
      expect(await execute(`${prefix}PRAGMA foreign_keys`)).toEqual([{ foreign_keys: 1 }]);
      expect((await execute(`${prefix}EXPLAIN SELECT 1`)).length).toBeGreaterThan(0);
      expect(await execute(`${prefix}SELECT 1 AS value WHERE 0`)).toEqual([]);
    });
  });
  test(`${adapter} executes mutations once and returns rows based on statement metadata`, async () => {
    await withDatabase(adapter, async (execute) => {
      expect(
        await execute(
          "/* schema */ CREATE TABLE items (id INTEGER PRIMARY KEY, value INTEGER, note TEXT)",
        ),
      ).toEqual([]);
      expect(
        await execute("/* write */ INSERT INTO items VALUES (1, 0, ?)", [
          " RETURNING is literal text ",
        ]),
      ).toEqual([]);
      expect(await execute("-- increment\nUPDATE items SET value=value+1 RETURNING* ")).toEqual([
        { id: 1, value: 1, note: " RETURNING is literal text " },
      ]);
      expect(await execute("UPDATE items SET value=value+1 RETURNING(value)")).toEqual([
        { value: 2 },
      ]);
      expect(
        await execute(
          "WITH delta AS (SELECT 3 AS value) UPDATE items SET value=value+(SELECT value FROM delta)",
        ),
      ).toEqual([]);
      expect(await execute("SELECT value FROM items")).toEqual([{ value: 5 }]);
      expect(await execute("INSERT INTO items VALUES (2, 6, 'new') RETURNING/* gap */id")).toEqual([
        { id: 2 },
      ]);
      expect(await execute("DELETE FROM items WHERE id=2 RETURNING(id)")).toEqual([{ id: 2 }]);
      expect(await execute("PRAGMA foreign_keys=ON")).toEqual([]);
      await expect(execute("/* malformed */ SELECT FROM")).rejects.toThrow();
      expect(await execute("SELECT count(*) AS total FROM items")).toEqual([{ total: 1 }]);
    });
  });
}

test("commented results and mutations retain transaction rollback", async () => {
  const db = createSqliteConnection(":memory:");
  try {
    await db.unsafe("CREATE TABLE items (value INTEGER)");
    await db.unsafe("INSERT INTO items VALUES (1)");
    const sentinel = new Error("rollback");
    await expect(
      db.begin(async (tx) => {
        expect(await tx.unsafe("/* before */ SELECT value FROM items")).toEqual([{ value: 1 }]);
        expect(
          await tx.unsafe("-- write\nUPDATE items SET value=value+1 RETURNING(value)"),
        ).toEqual([{ value: 2 }]);
        throw sentinel;
      }),
    ).rejects.toBe(sentinel);
    expect(await db.unsafe("/* after */ SELECT value FROM items")).toEqual([{ value: 1 }]);
  } finally {
    db.close();
  }
});
