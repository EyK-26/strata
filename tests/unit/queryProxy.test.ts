import { expect, test } from "bun:test";
import { createDatabaseQueryProxy } from "@getstrata/core";
import { runWithDatabaseConnection } from "@getstrata/core/database/connectionContext";
import type { SqlDatabaseConnection } from "../../src/core/database/connectionContracts";

test("explicit query proxy routes work through raw context but keeps pool lifecycle methods on its supplied owner", async () => {
  const calls: string[] = [];
  const make = (name: string) => {
    const connection = Object.assign(
      async () => {
        calls.push(`${name}.tagged`);
        return [{ name }];
      },
      {
        unsafe: async () => {
          calls.push(`${name}.unsafe`);
          return [{ name }];
        },
        begin: async (callback: (selected: typeof connection) => Promise<unknown>) => {
          calls.push(`${name}.begin`);
          return callback(connection);
        },
        close: async () => {
          calls.push(`${name}.close`);
        },
        connect: async () => {
          calls.push(`${name}.connect`);
          return connection;
        },
      },
    );
    return connection as unknown as SqlDatabaseConnection;
  };
  const pool = make("pool"),
    scoped = make("scoped");
  const query = createDatabaseQueryProxy(pool);
  expect(await query`SELECT 1`).toEqual([{ name: "pool" }]);
  await runWithDatabaseConnection(scoped, async () => {
    expect(await query`SELECT 2`).toEqual([{ name: "scoped" }]);
    expect(await query.unsafe("SELECT 3")).toEqual([{ name: "scoped" }]);
    await query.begin?.(async () => undefined);
    await (query as SqlDatabaseConnection & { connect(): Promise<unknown> }).connect();
    await query.close?.();
  });
  expect(await query.unsafe("SELECT 4")).toEqual([{ name: "pool" }]);
  expect(calls).toEqual([
    "pool.tagged",
    "scoped.tagged",
    "scoped.unsafe",
    "pool.begin",
    "pool.connect",
    "pool.close",
    "pool.unsafe",
  ]);
});
