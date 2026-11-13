import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createDatabaseBindings } from "@getstrata/core/database/bindings";
import type { ActiveDatabaseHandle } from "@getstrata/core/database/connectionContext";
import { createSqliteConnection } from "@getstrata/core/database/sqliteConnection";
import { DATABASE_SESSION_TOKEN } from "@getstrata/core/database/tokens";
import { createApplication } from "@getstrata/core/runtime/application";

describe("published SQLite async transactions", () => {
  let connection: ReturnType<typeof createSqliteConnection>;
  beforeEach(async () => {
    connection = createSqliteConnection(":memory:");
    await connection.unsafe("CREATE TABLE effects (value INTEGER UNIQUE)");
  });
  afterEach(() => {
    connection.close();
  });

  test("Date bindings preserve positional parameters and UTC timestamps", async () => {
    await connection.unsafe("CREATE TABLE stamps (id INTEGER PRIMARY KEY, stamp TEXT)");
    await connection.unsafe("INSERT INTO stamps VALUES (?,?)", [1, null]);
    const stamp = new Date("2026-10-09T12:00:00.000Z");
    await connection.begin(async (tx) => {
      expect(
        await tx.unsafe("UPDATE stamps SET stamp=? WHERE id=? RETURNING id,stamp", [stamp, 1]),
      ).toEqual([{ id: 1, stamp: stamp.toISOString() }]);
      expect(await tx.unsafe("SELECT id FROM stamps WHERE stamp=? AND id=?", [stamp, 1])).toEqual([
        { id: 1 },
      ]);
    });
    await expect(
      connection.unsafe("INSERT INTO stamps VALUES (?,?)", [2, new Date(Number.NaN)]),
    ).rejects.toThrow();
    expect(await connection.unsafe("SELECT id FROM stamps ORDER BY id")).toEqual([{ id: 1 }]);
  });

  test("public adapter commits awaited handle and connection writes", async () => {
    await connection.begin(async (tx) => {
      await tx.unsafe("INSERT INTO effects VALUES (?)", [1]);
      await Bun.sleep(5);
      await connection.unsafe("INSERT INTO effects VALUES (?)", [2]);
    });
    expect(await connection.unsafe("SELECT value FROM effects ORDER BY value")).toEqual([
      { value: 1 },
      { value: 2 },
    ]);
  });

  test("public adapter rolls back awaited writes after async failure", async () => {
    await expect(
      connection.begin(async (tx) => {
        await tx.unsafe("INSERT INTO effects VALUES (1)");
        await Promise.resolve();
        throw new Error("failed");
      }),
    ).rejects.toThrow("failed");
    expect(await connection.unsafe("SELECT * FROM effects")).toEqual([]);
  });

  test("rejects stale handles, closed connections, and direct nested begin", async () => {
    let stale: ActiveDatabaseHandle | undefined;
    await connection.begin(async (tx) => {
      stale = tx;
      await expect(connection.begin(async () => {})).rejects.toThrow("active transaction handle");
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
      connection.begin((tx) => tx.unsafe("INSERT INTO child VALUES (42)")),
    ).rejects.toThrow();
    expect(await connection.unsafe("SELECT * FROM child")).toEqual([]);
    await connection.begin((tx) => tx.unsafe("INSERT INTO parent VALUES (42)"));
  });
});

async function bounded<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), 3000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
function gate() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
test("canonical SQLite queues same-pool roots and outsider reads behind a rolled-back writer", async () => {
  const app = createApplication({
    providers: [],
    services: createDatabaseBindings({
      default: "main",
      connections: { main: { driver: "sqlite", filename: ":memory:" } },
    }),
  });
  const entered = gate();
  const release = gate();
  const secondStarted = gate();
  const readerStarted = gate();
  const failures: unknown[] = [];
  const pending: Promise<unknown>[] = [];
  const order: string[] = [];
  const marker = new Error("rollback first writer");
  try {
    await app.start();
    await app.run((scope) =>
      scope
        .resolve(DATABASE_SESSION_TOKEN)
        .execute({ text: "CREATE TABLE queued_rows(id INTEGER PRIMARY KEY)", params: [] }),
    );
    const first = app.run((scope) =>
      scope.resolve(DATABASE_SESSION_TOKEN).transaction(async (tx) => {
        order.push("first.enter");
        await tx.execute({ text: "INSERT INTO queued_rows VALUES (1)", params: [] });
        entered.resolve();
        await release.promise;
        order.push("first.rollback");
        throw marker;
      }),
    );
    const observed = first.then(
      () => {
        throw new Error("Expected writer rollback");
      },
      (error) => {
        expect(error).toBe(marker);
      },
    );
    pending.push(observed);
    void first.catch(() => entered.resolve());
    await bounded(entered.promise, "first SQLite writer");
    const second = app.run((scope) => {
      const database = scope.resolve(DATABASE_SESSION_TOKEN);
      secondStarted.resolve();
      return database.transaction(async (tx) => {
        order.push("second.enter");
        await tx.execute({ text: "INSERT INTO queued_rows VALUES (2)", params: [] });
      });
    });
    pending.push(second);
    const outsider = app.run((scope) => {
      readerStarted.resolve();
      return scope
        .resolve(DATABASE_SESSION_TOKEN)
        .execute<{ id: number }>({ text: "SELECT id FROM queued_rows ORDER BY id", params: [] })
        .then((rows) => {
          order.push("outsider.read");
          return rows;
        });
    });
    pending.push(outsider);
    await bounded(
      Promise.all([secondStarted.promise, readerStarted.promise]),
      "SQLite contenders submitted",
    );
    expect(order).toEqual(["first.enter"]);
    release.resolve();
    await bounded(Promise.all([observed, second]), "SQLite queued writer termination");
    const rows = await bounded(outsider, "SQLite outsider read");
    expect(rows).not.toContainEqual({ id: 1 });
    expect(order.indexOf("second.enter")).toBeGreaterThan(order.indexOf("first.rollback"));
    expect(order.indexOf("outsider.read")).toBeGreaterThan(order.indexOf("first.rollback"));
    expect(
      await app.run((scope) =>
        scope
          .resolve(DATABASE_SESSION_TOKEN)
          .execute({ text: "SELECT id FROM queued_rows ORDER BY id", params: [] }),
      ),
    ).toEqual([{ id: 2 }]);
  } catch (error) {
    failures.push(error);
  } finally {
    release.resolve();
    const results = await Promise.allSettled(pending);
    for (const result of results) if (result.status === "rejected") failures.push(result.reason);
    try {
      const stopped = await app.stop();
      if (!stopped.successful)
        failures.push(new Error("SQLite queue cleanup failed", { cause: stopped }));
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length) throw new AggregateError(failures, "SQLite queue and cleanup failed");
});
