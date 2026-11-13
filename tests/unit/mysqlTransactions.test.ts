import { describe, expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { ActiveDatabaseHandle } from "@getstrata/core/database/connectionContext";
import { createMysqlConnectionFromPool } from "@getstrata/core/database/mysqlConnection";

function fixture(fail?: "start" | "commit" | "rollback") {
  const socket = new EventEmitter();
  const reserved = {
    connection: { stream: socket },
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
    destroy: mock(() => {
      socket.emit("close");
    }),
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
  return { connection, pool, reserved };
}

describe("MySQL connection-pinned async transactions", () => {
  test("public adapter pins awaited connection and transaction-handle SQL", async () => {
    const { connection, pool, reserved } = fixture();
    await connection.begin(async (tx) => {
      expect(await connection.unsafe("SELECT 1")).toEqual([{ source: "reserved" }]);
      await Bun.sleep(1);
      expect(await tx.unsafe("SELECT 2")).toEqual([{ source: "reserved" }]);
    });
    expect(pool.execute).not.toHaveBeenCalled();
    expect(reserved.commit).toHaveBeenCalledTimes(1);
    expect(reserved.release).toHaveBeenCalledTimes(1);
  });
  test("rolls back callback failures and releases the connection", async () => {
    const { connection, reserved } = fixture();
    await expect(
      connection.begin(async () => {
        throw new Error("business failed");
      }),
    ).rejects.toThrow("business failed");
    expect(reserved.rollback).toHaveBeenCalledTimes(1);
    expect(reserved.commit).not.toHaveBeenCalled();
    expect(reserved.release).toHaveBeenCalledTimes(1);
  });
  test("rolls back commit errors", async () => {
    const { connection, reserved } = fixture("commit");
    await expect(connection.begin(async () => {})).rejects.toThrow("commit failed");
    expect(reserved.rollback).toHaveBeenCalledTimes(1);
    expect(reserved.release).toHaveBeenCalledTimes(1);
  });
  test("discards a session whose rollback failed", async () => {
    const { connection, reserved } = fixture("rollback");
    await expect(
      connection.begin(async () => {
        throw new Error("business failed");
      }),
    ).rejects.toThrow("connection discarded");
    expect(reserved.destroy).toHaveBeenCalledTimes(1);
    expect(reserved.release).not.toHaveBeenCalled();
  });
  test("discards an uncertain failed BEGIN", async () => {
    const { connection, reserved } = fixture("start");
    await expect(connection.begin(async () => {})).rejects.toThrow("start failed");
    expect(reserved.destroy).toHaveBeenCalledTimes(1);
    expect(reserved.release).not.toHaveBeenCalled();
  });
  test("public adapter rejects direct nested begin and stale handles", async () => {
    const { connection } = fixture();
    let stale: ActiveDatabaseHandle | undefined;
    await connection.begin(async (tx) => {
      stale = tx;
      await expect(connection.begin(async () => {})).rejects.toThrow("active transaction handle");
      await tx.unsafe("SELECT 1");
    });
    await expect(stale?.unsafe("SELECT 1")).rejects.toThrow("no longer active");
    await connection.close();
  });
  test("fails explicitly when a supplied executable cannot reserve a connection", async () => {
    const connection = createMysqlConnectionFromPool({ execute: async () => [[], []] });
    await expect(connection.begin(async () => {})).rejects.toThrow("getConnection");
    await connection.close();
  });
});
