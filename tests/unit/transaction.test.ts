import { afterEach, describe, expect, test } from "bun:test";
import type { DatabaseConnection } from "../../src/core/database/baseRepository.ts";
import { bindDatabaseConnection } from "../../src/core/database/bindConnection.ts";
import { resetBoundDatabaseConnection } from "../../src/core/database/boundConnection.ts";
import { createDatabaseConnection } from "../../src/core/database/connection.ts";
import { runInTransaction } from "../../src/core/database/transaction.ts";

type TransactionCapableConnection = DatabaseConnection & {
  begin<TValue>(
    callback: (transaction: Parameters<typeof createDatabaseConnection>[0]) => Promise<TValue>,
  ): Promise<TValue>;
};

describe("runInTransaction", () => {
  afterEach(() => {
    resetBoundDatabaseConnection();
  });

  test("uses a bound connection with begin() when one is registered", async () => {
    const calls: string[] = [];

    const transactionConnection: DatabaseConnection = {
      async unsafe<T>(query: string) {
        calls.push(`tx:${query}`);
        return [] as T[];
      },
    };

    const bound = {
      async unsafe<T>(query: string) {
        calls.push(`pool:${query}`);
        return [] as T[];
      },
      async begin<T>(callback: (transaction: DatabaseConnection) => Promise<T>) {
        calls.push("begin");
        return await callback(transactionConnection);
      },
    } satisfies TransactionCapableConnection;

    bindDatabaseConnection(bound);

    await runInTransaction(async (connection) => {
      await connection.unsafe("INSERT INTO forum_replies VALUES ($1)", [1]);
    });

    expect(calls).toEqual(["begin", "tx:INSERT INTO forum_replies VALUES ($1)"]);
  });

  test("wraps raw unsafe clients in DatabaseConnection adapters inside the transaction", async () => {
    const rawTransaction = {
      async unsafe<T>(query: string, params: readonly unknown[] = []) {
        expect(query).toBe("SELECT 1");
        expect(params).toEqual([]);
        return [{ ok: true }] as T[];
      },
    };

    bindDatabaseConnection({
      async unsafe() {
        return [];
      },
      async begin<T>(callback: (transaction: typeof rawTransaction) => Promise<T>) {
        return await callback(rawTransaction);
      },
    } as DatabaseConnection & TransactionCapableConnection);

    const rows = await runInTransaction(async (connection) => connection.unsafe("SELECT 1"));
    expect(rows).toEqual([{ ok: true }]);
  });

  test("rejects when the active connection has no begin()", async () => {
    bindDatabaseConnection(
      createDatabaseConnection({
        async unsafe() {
          return [];
        },
      }),
    );

    await expect(runInTransaction(async () => undefined)).rejects.toThrow(
      "Active database connection does not support transactions",
    );
  });
});
