import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  bindDatabaseConnection,
  resetBoundDatabaseConnection,
} from "@getstrata/core/database/boundConnection";
import type { ActiveDatabaseHandle } from "@getstrata/core/database/connectionContext";
import { repositoryConnection as db } from "@getstrata/core/database/repositoryConnection";
import { createSqliteConnection } from "@getstrata/core/database/sqliteConnection";
import { runInTransaction } from "@getstrata/core/database/transaction";
import { dispatchModelEvent, eventBus } from "@getstrata/core/events";

describe("published SQLite async transactions", () => {
  let connection: ReturnType<typeof createSqliteConnection>;
  beforeEach(async () => {
    connection = createSqliteConnection(":memory:");
    bindDatabaseConnection(connection);
    await connection.unsafe("CREATE TABLE effects (value INTEGER UNIQUE)");
  });
  afterEach(() => {
    resetBoundDatabaseConnection();
    connection.close();
  });

  test("Date bindings preserve positional parameters and UTC timestamps", async () => {
    await connection.unsafe("CREATE TABLE stamps (id INTEGER PRIMARY KEY, stamp TEXT)");
    await connection.unsafe("INSERT INTO stamps VALUES (?,?)", [1, null]);
    const stamp = new Date("2026-10-09T12:00:00.000Z");
    await runInTransaction(async () => {
      expect(
        await db.unsafe("UPDATE stamps SET stamp=? WHERE id=? RETURNING id,stamp", [stamp, 1]),
      ).toEqual([{ id: 1, stamp: stamp.toISOString() }]);
      expect(await db.unsafe("SELECT id FROM stamps WHERE stamp=? AND id=?", [stamp, 1])).toEqual([
        { id: 1 },
      ]);
    });
    await expect(
      connection.unsafe("INSERT INTO stamps VALUES (?,?)", [2, new Date(Number.NaN)]),
    ).rejects.toThrow();
    expect(await connection.unsafe("SELECT id FROM stamps ORDER BY id")).toEqual([{ id: 1 }]);
  });

  test("commits awaited pool and repository writes through the active connection", async () => {
    await runInTransaction(async () => {
      await db.unsafe("INSERT INTO effects VALUES (?)", [1]);
      await Bun.sleep(5);
      await connection.unsafe("INSERT INTO effects VALUES (?)", [2]);
    });
    expect(await connection.unsafe("SELECT value FROM effects ORDER BY value")).toEqual([
      { value: 1 },
      { value: 2 },
    ]);
  });

  test("rolls back writes and deferred events after async failure", async () => {
    let deliveries = 0;
    const off = eventBus.listen("sqlite.effects", () => {
      deliveries++;
    });
    try {
      await expect(
        runInTransaction(async () => {
          await connection.unsafe("INSERT INTO effects VALUES (1)");
          await dispatchModelEvent("sqlite.effects", 1);
          await Bun.sleep(5);
          throw new Error("failed");
        }),
      ).rejects.toThrow("failed");
      expect(await connection.unsafe("SELECT * FROM effects")).toEqual([]);
      expect(deliveries).toBe(0);
    } finally {
      off();
    }
  });

  test("nested runInTransaction uses savepoints with real SQLite", async () => {
    await runInTransaction(async () => {
      await db.unsafe("INSERT INTO effects VALUES (1)");
      await expect(
        runInTransaction(async () => {
          await db.unsafe("INSERT INTO effects VALUES (2)");
          throw new Error("nested");
        }),
      ).rejects.toThrow("nested");
      await runInTransaction(() => db.unsafe("INSERT INTO effects VALUES (3)"));
    });
    expect(await db.unsafe("SELECT value FROM effects ORDER BY value")).toEqual([
      { value: 1 },
      { value: 3 },
    ]);
  });

  test("serializes concurrent root transactions and unrelated queries", async () => {
    const order: string[] = [];
    const first = runInTransaction(async () => {
      order.push("first-start");
      await db.unsafe("INSERT INTO effects VALUES (1)");
      await Bun.sleep(20);
      order.push("first-end");
    });
    const second = runInTransaction(async () => {
      order.push("second-start");
      await db.unsafe("INSERT INTO effects VALUES (2)");
    });
    const read = connection.unsafe<{ value: number }>("SELECT value FROM effects ORDER BY value");
    await Promise.all([first, second]);
    expect(await read).toEqual([{ value: 1 }, { value: 2 }]);
    expect(order).toEqual(["first-start", "first-end", "second-start"]);
  });

  test("does not expose rolled-back writes to unrelated reads", async () => {
    let started: (() => void) | undefined;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const write = runInTransaction(async () => {
      await db.unsafe("INSERT INTO effects VALUES (1)");
      started?.();
      await Bun.sleep(20);
      throw new Error("rollback");
    });
    const rejected = expect(write).rejects.toThrow("rollback");
    await ready;
    const read = connection.unsafe("SELECT * FROM effects");
    await rejected;
    expect(await read).toEqual([]);
  });

  test("rejects stale handles, closed connections, and direct nested begin", async () => {
    let stale: ActiveDatabaseHandle | undefined;
    await connection.begin(async (tx) => {
      stale = tx;
      await expect(connection.begin(async () => {})).rejects.toThrow("runInTransaction");
      await tx.unsafe("INSERT INTO effects VALUES (1)");
    });
    await expect(stale?.unsafe("SELECT * FROM effects")).rejects.toThrow("no longer active");
    connection.close();
    await expect(connection.unsafe("SELECT 1")).rejects.toThrow("closed");
  });

  test("refuses close while a transaction is pending", async () => {
    const write = connection.begin(async () => {
      await Bun.sleep(10);
    });
    expect(() => connection.close()).toThrow("Drain SQLite operations");
    await write;
  });

  test("a deferred constraint failure at COMMIT rolls back and leaves the queue usable", async () => {
    await connection.unsafe("CREATE TABLE parent (id INTEGER PRIMARY KEY)");
    await connection.unsafe(
      "CREATE TABLE child (parent INTEGER REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED)",
    );
    await expect(
      runInTransaction(() => db.unsafe("INSERT INTO child VALUES (42)")),
    ).rejects.toThrow();
    expect(await connection.unsafe("SELECT * FROM child")).toEqual([]);
    await runInTransaction(() => db.unsafe("INSERT INTO parent VALUES (42)"));
  });
});
