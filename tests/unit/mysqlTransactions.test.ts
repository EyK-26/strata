import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  bindDatabaseConnection,
  resetBoundDatabaseConnection,
} from "@getstrata/core/database/boundConnection";
import type { ActiveDatabaseHandle } from "@getstrata/core/database/connectionContext";
import { resetSqlDialect, useSqlDialect } from "@getstrata/core/database/dialect";
import { createMysqlConnectionFromPool } from "@getstrata/core/database/mysqlConnection";
import { repositoryConnection as db } from "@getstrata/core/database/repositoryConnection";
import { runInTransaction } from "@getstrata/core/database/transaction";

afterEach(() => {
  resetBoundDatabaseConnection();
  resetSqlDialect();
});
function fixture(fail?: "start" | "commit" | "rollback") {
  const reserved = {
    execute: mock(
      async (_query: string, _params?: unknown[]) =>
        [[{ source: "reserved" }], []] as [unknown, unknown],
    ),
    beginTransaction: mock(async () => {
      if (fail === "start") throw new Error("start failed");
    }),
    commit: mock(async () => {
      if (fail === "commit") throw new Error("commit failed");
    }),
    rollback: mock(async () => {
      if (fail === "rollback") throw new Error("rollback failed");
    }),
    release: mock(() => {}),
    destroy: mock(() => {}),
  };
  const pool = {
    execute: mock(
      async (_query: string, _params?: unknown[]) =>
        [[{ source: "pool" }], []] as [unknown, unknown],
    ),
    getConnection: mock(async () => reserved),
    end: mock(async () => {}),
  };
  const connection = createMysqlConnectionFromPool(pool);
  bindDatabaseConnection(connection);
  useSqlDialect("mysql");
  return { connection, pool, reserved };
}

describe("MySQL connection-pinned async transactions", () => {
  test("uses the reserved connection for awaited pool and repository SQL", async () => {
    const { connection, pool, reserved } = fixture();
    await runInTransaction(async () => {
      expect(await connection.unsafe("SELECT 1")).toEqual([{ source: "reserved" }]);
      await Bun.sleep(1);
      expect(await db.unsafe("SELECT 2")).toEqual([{ source: "reserved" }]);
    });
    expect(pool.execute).not.toHaveBeenCalled();
    expect(reserved.commit).toHaveBeenCalledTimes(1);
    expect(reserved.release).toHaveBeenCalledTimes(1);
  });
  test("rolls back callback failures and releases the connection", async () => {
    const { reserved } = fixture();
    await expect(
      runInTransaction(async () => {
        throw new Error("business failed");
      }),
    ).rejects.toThrow("business failed");
    expect(reserved.rollback).toHaveBeenCalledTimes(1);
    expect(reserved.commit).not.toHaveBeenCalled();
    expect(reserved.release).toHaveBeenCalledTimes(1);
  });
  test("rolls back commit errors", async () => {
    const { reserved } = fixture("commit");
    await expect(runInTransaction(async () => {})).rejects.toThrow("commit failed");
    expect(reserved.rollback).toHaveBeenCalledTimes(1);
    expect(reserved.release).toHaveBeenCalledTimes(1);
  });
  test("discards a session whose rollback failed", async () => {
    const { reserved } = fixture("rollback");
    await expect(
      runInTransaction(async () => {
        throw new Error("business failed");
      }),
    ).rejects.toThrow("connection discarded");
    expect(reserved.destroy).toHaveBeenCalledTimes(1);
    expect(reserved.release).not.toHaveBeenCalled();
  });
  test("discards an uncertain failed BEGIN", async () => {
    const { reserved } = fixture("start");
    await expect(runInTransaction(async () => {})).rejects.toThrow("start failed");
    expect(reserved.destroy).toHaveBeenCalledTimes(1);
    expect(reserved.release).not.toHaveBeenCalled();
  });
  test("supports framework savepoints and rejects direct nested begin and stale handles", async () => {
    const { connection, reserved } = fixture();
    let stale: ActiveDatabaseHandle | undefined;
    await connection.begin(async (tx) => {
      stale = tx;
      await expect(connection.begin(async () => {})).rejects.toThrow("runInTransaction");
      await runInTransaction(async () => {
        await db.unsafe("SELECT 1");
      });
    });
    expect(
      reserved.execute.mock.calls.some(([query]) => String(query).startsWith("SAVEPOINT")),
    ).toBe(true);
    await expect(stale?.unsafe("SELECT 1")).rejects.toThrow("no longer active");
    await connection.close();
  });
  test("fails explicitly when a supplied executable cannot reserve a connection", async () => {
    const connection = createMysqlConnectionFromPool({ execute: async () => [[], []] });
    await expect(connection.begin(async () => {})).rejects.toThrow("getConnection");
    await connection.close();
  });
});
