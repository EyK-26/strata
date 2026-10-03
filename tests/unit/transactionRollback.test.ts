import { afterEach, describe, expect, test } from "bun:test";
import type { SqlDatabaseConnection } from "@getstrata/core/database/baseRepository";
import { bindDatabaseConnection } from "@getstrata/core/database/bindConnection";
import { resetBoundDatabaseConnection } from "@getstrata/core/database/boundConnection";
import { runWithDatabaseConnection } from "@getstrata/core/database/connectionContext";
import {
  getDefaultDatabasePool,
  registerDefaultDatabasePool,
  resetDefaultDatabasePoolForTests,
} from "@getstrata/core/database/defaultConnection";
import { requestTransactionRollback, runInTransaction } from "@getstrata/core/database/transaction";
import { withJsonErrorHandling } from "@getstrata/core/http/response";
import { runWithMigrationBypass } from "@getstrata/core/tenant/databaseTenantContext";
import { currentTenant, type TenantContext } from "@getstrata/core/tenant/tenantContext";
import { runWithTenantDatabase } from "@getstrata/core/tenant/tenantDatabaseScope";
import { getDatabase } from "../../src/db/connection";
import { restoreEnvVar } from "../helpers/restoreEnv";
import { defaultTestTenant } from "./testHelpers";

const otherTenant: TenantContext = {
  id: 2,
  slug: "beta",
  plan: "pro",
  region: "us",
};

type SqlCall = { query: string; params: readonly unknown[] };

type FakeTransaction = {
  unsafe<T>(query: string, params?: readonly unknown[]): Promise<T[]>;
  savepoint?<T>(callback: (savepoint: FakeTransaction) => Promise<T>): Promise<T>;
};

function restorePool(previous: SqlDatabaseConnection | null): void {
  if (previous) {
    registerDefaultDatabasePool(previous);
    return;
  }
  resetDefaultDatabasePoolForTests();
  if (process.env.DATABASE_URL) {
    getDatabase();
  }
}

function currentPoolOrNull(): SqlDatabaseConnection | null {
  try {
    return getDefaultDatabasePool();
  } catch {
    return null;
  }
}

function installFakePool(
  options: { savepoint?: boolean; wrapErrors?: boolean; sessionRow?: boolean } = {},
): {
  calls: string[];
  sql: SqlCall[];
} {
  const calls: string[] = [];
  const sql: SqlCall[] = [];
  const tx: FakeTransaction = {
    async unsafe<T>(query: string, params: readonly unknown[] = []): Promise<T[]> {
      sql.push({ query, params: [...params] });
      if (query.startsWith("SAVEPOINT ")) calls.push("savepoint");
      if (query.startsWith("ROLLBACK TO SAVEPOINT ")) calls.push("rollback-savepoint");
      if (query.includes("current_setting")) {
        if (options.sessionRow === false) {
          return [] as T[];
        }
        return [{ tenant_id: "1", bypass_rls: "false" }] as T[];
      }
      return [] as T[];
    },
    async savepoint<T>(callback: (savepoint: FakeTransaction) => Promise<T>): Promise<T> {
      calls.push("savepoint");
      try {
        return await callback(tx);
      } catch (error) {
        calls.push("rollback-savepoint");
        throw error;
      }
    },
  };
  if (options.savepoint === false) {
    delete (tx as { savepoint?: unknown }).savepoint;
  }

  const pool = Object.assign(async () => [] as unknown[], {
    async begin<T>(callback: (transaction: FakeTransaction) => Promise<T>): Promise<T> {
      calls.push("begin");
      try {
        const result = await callback(tx);
        calls.push("commit");
        return result;
      } catch (error) {
        calls.push("rollback");
        if (options.wrapErrors) {
          throw new Error("wrapped", { cause: error });
        }
        throw error;
      }
    },
    async close() {},
    async unsafe<T>() {
      return [] as T[];
    },
  });
  registerDefaultDatabasePool(pool as SqlDatabaseConnection);
  return { calls, sql };
}

describe("transaction rollback boundaries", () => {
  const previousTenancy = process.env.TENANCY_DRIVER;
  const previousPool = currentPoolOrNull();

  afterEach(() => {
    restorePool(previousPool);
    restoreEnvVar("TENANCY_DRIVER", previousTenancy);
    resetBoundDatabaseConnection();
  });

  test("requestTransactionRollback outside a transaction does nothing", () => {
    requestTransactionRollback();
  });

  test("rolls back when JSON error handling swallows a thrown error", async () => {
    process.env.TENANCY_DRIVER = "rls";
    const { calls } = installFakePool();

    const response = await runWithTenantDatabase(defaultTestTenant, async () => {
      return await withJsonErrorHandling(async () => {
        throw new Error("observer failed");
      })();
    });

    expect(response.status).toBe(500);
    expect(calls).toContain("rollback");
    expect(calls).not.toContain("commit");
  });

  test("unwraps a driver error that wraps the rollback signal", async () => {
    process.env.TENANCY_DRIVER = "rls";
    const { calls } = installFakePool({ wrapErrors: true });

    const response = await runWithTenantDatabase(defaultTestTenant, async () => {
      return await withJsonErrorHandling(async () => {
        throw new Error("observer failed");
      })();
    });

    expect(response.status).toBe(500);
    expect(calls).toContain("rollback");
    expect(calls).not.toContain("commit");
  });

  test("commits a returned 4xx response", async () => {
    process.env.TENANCY_DRIVER = "rls";
    const { calls } = installFakePool();

    const response = await runWithTenantDatabase(defaultTestTenant, async () => {
      return new Response("invalid", { status: 422 });
    });

    expect(response.status).toBe(422);
    expect(calls).toContain("commit");
    expect(calls).not.toContain("rollback");
  });

  test("propagates a thrown error and rolls back the outer transaction", async () => {
    process.env.TENANCY_DRIVER = "rls";
    const { calls } = installFakePool();

    await expect(
      runWithTenantDatabase(defaultTestTenant, async () => {
        throw new Error("db down");
      }),
    ).rejects.toThrow("db down");

    expect(calls).toContain("rollback");
    expect(calls).not.toContain("commit");
  });

  test("rejects a different tenant before changing the database context", async () => {
    process.env.TENANCY_DRIVER = "rls";
    const { calls, sql } = installFakePool();
    await runWithTenantDatabase(defaultTestTenant, async () => {
      await expect(runWithTenantDatabase(otherTenant, async () => undefined)).rejects.toThrow(
        "Cannot switch tenants",
      );
      expect(currentTenant()?.id).toBe(1);
    });
    expect(
      sql
        .filter((call) => call.query.includes("set_config('app.tenant_id'"))
        .map((call) => call.params[0]),
    ).toEqual(["1"]);
    expect(calls).not.toContain("savepoint");
    expect(calls).toContain("commit");
    expect(currentTenant()).toBeNull();
  });

  test("rolls back a nested savepoint when the inner scope throws", async () => {
    process.env.TENANCY_DRIVER = "rls";
    const { calls } = installFakePool();

    const result = await runWithTenantDatabase(defaultTestTenant, async () => {
      try {
        await runWithTenantDatabase(defaultTestTenant, async () => {
          throw new Error("inner");
        });
        return "unexpected";
      } catch (error) {
        return error instanceof Error ? error.message : "unknown";
      }
    });

    expect(result).toBe("inner");
    expect(calls).toContain("rollback-savepoint");
    expect(calls).toContain("commit");
    expect(calls).not.toContain("rollback");
  });

  test("rolls back a nested savepoint when error handling returns a response", async () => {
    process.env.TENANCY_DRIVER = "rls";
    const { calls } = installFakePool();

    const response = await runWithTenantDatabase(defaultTestTenant, async () => {
      return await runWithTenantDatabase(defaultTestTenant, async () => {
        return await withJsonErrorHandling(async () => {
          throw new Error("observer failed");
        })();
      });
    });

    expect(response.status).toBe(500);
    expect(calls).toContain("rollback-savepoint");
    expect(calls).toContain("commit");
    expect(calls).not.toContain("rollback");
  });

  test("restores tenant session when the open connection has no savepoint", async () => {
    process.env.TENANCY_DRIVER = "rls";
    const { calls, sql } = installFakePool({ savepoint: false, sessionRow: false });

    await runWithTenantDatabase(defaultTestTenant, async () => {
      await runWithTenantDatabase(defaultTestTenant, async () => {
        expect(currentTenant()?.id).toBe(1);
      });
      expect(currentTenant()?.id).toBe(1);
    });

    expect(calls).toContain("savepoint");
    expect(sql.some((call) => call.params[0] === "")).toBe(true);
    expect(calls).toContain("commit");
  });

  test("uses a savepoint for runInTransaction inside an open tenant transaction", async () => {
    process.env.TENANCY_DRIVER = "rls";
    const { calls } = installFakePool();

    const result = await runWithTenantDatabase(defaultTestTenant, async () => {
      await expect(
        runInTransaction(async () => {
          throw new Error("save");
        }),
      ).rejects.toThrow("save");
      return "outer-ok";
    });

    expect(result).toBe("outer-ok");
    expect(calls).toContain("rollback-savepoint");
    expect(calls).toContain("commit");
  });

  test("runInTransaction uses SQL savepoints without a driver savepoint helper", async () => {
    const calls: string[] = [];
    bindDatabaseConnection({
      async unsafe() {
        return [];
      },
      async begin<T>(callback: (connection: { unsafe: () => Promise<unknown[]> }) => Promise<T>) {
        calls.push("begin");
        return await callback({
          async unsafe() {
            return [];
          },
        });
      },
    } as unknown as SqlDatabaseConnection);

    await runWithDatabaseConnection(
      {
        async unsafe() {
          return [];
        },
      },
      async () => {
        await runInTransaction(async (connection) => {
          await connection.unsafe("SELECT 1");
        });
      },
    );

    expect(calls).toEqual([]);
  });

  test("requestTransactionRollback rolls back a migration bypass transaction", async () => {
    process.env.TENANCY_DRIVER = "rls";
    const { calls } = installFakePool();

    const result = await runWithMigrationBypass(async () => {
      requestTransactionRollback();
      return "rolled";
    });

    expect(result).toBe("rolled");
    expect(calls).toContain("rollback");
    expect(calls).not.toContain("commit");
  });
});
