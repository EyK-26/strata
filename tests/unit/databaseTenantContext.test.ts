import { describe, expect, test } from "bun:test";
import type { SqlDatabaseConnection } from "@getstrata/core/database/baseRepository";
import { runWithDatabaseConnection } from "@getstrata/core/database/connectionContext";
import {
  getDefaultDatabasePool,
  registerDefaultDatabasePool,
  resetDefaultDatabasePoolForTests,
} from "@getstrata/core/database/defaultConnection";
import { runWithMigrationBypass } from "@getstrata/core/tenant/databaseTenantContext";
import { getDatabase } from "../../src/db/connection";
import { restoreEnvVar } from "../helpers/restoreEnv";

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

function fakePool(calls: string[]): SqlDatabaseConnection {
  const pool = Object.assign(async () => [] as unknown[], {
    async begin<T>(callback: (tx: typeof pool) => Promise<T>) {
      calls.push("begin");
      return await callback(pool);
    },
    async close() {},
    async unsafe<T>(query: string, params?: readonly unknown[]) {
      calls.push(`${query} ${JSON.stringify(params ?? [])}`);
      return [] as T[];
    },
  });
  return pool as SqlDatabaseConnection;
}

describe("runWithMigrationBypass", () => {
  test("skips set_config when TENANCY_DRIVER=none", async () => {
    const previous = process.env.TENANCY_DRIVER;
    process.env.TENANCY_DRIVER = "none";

    try {
      await expect(runWithMigrationBypass(async () => "ok")).resolves.toBe("ok");
    } finally {
      restoreEnvVar("TENANCY_DRIVER", previous);
    }
  });

  test("skips set_config when TENANCY_DRIVER=column", async () => {
    const previous = process.env.TENANCY_DRIVER;
    process.env.TENANCY_DRIVER = "column";

    try {
      await expect(runWithMigrationBypass(async () => "ok")).resolves.toBe("ok");
    } finally {
      restoreEnvVar("TENANCY_DRIVER", previous);
    }
  });

  test("opens a transaction and uses SET LOCAL when TENANCY_DRIVER=rls", async () => {
    const previous = process.env.TENANCY_DRIVER;
    process.env.TENANCY_DRIVER = "rls";
    const restored = currentPoolOrNull();
    const calls: string[] = [];
    registerDefaultDatabasePool(fakePool(calls));

    try {
      await expect(runWithMigrationBypass(async () => "ok")).resolves.toBe("ok");
      expect(calls[0]).toBe("begin");
      expect(calls[1]).toContain("set_config('app.bypass_rls'");
      expect(calls[1]).toContain('["true"]');
    } finally {
      restorePool(restored);
      restoreEnvVar("TENANCY_DRIVER", previous);
    }
  });

  test("opens a nested transaction instead of setting bypass on the request connection", async () => {
    const previous = process.env.TENANCY_DRIVER;
    process.env.TENANCY_DRIVER = "rls";
    const restored = currentPoolOrNull();
    const calls: string[] = [];
    const pool = fakePool(calls);
    registerDefaultDatabasePool(pool);

    try {
      await runWithDatabaseConnection(pool, async () => {
        await expect(runWithMigrationBypass(async () => "nested")).resolves.toBe("nested");
      });
      expect(calls.some((line) => line === "begin")).toBe(true);
      expect(calls.filter((line) => line.includes("set_config")).length).toBe(1);
      expect(calls.some((line) => line.includes('["true"]'))).toBe(true);
      expect(calls.some((line) => line.includes('["false"]'))).toBe(false);
    } finally {
      restorePool(restored);
      restoreEnvVar("TENANCY_DRIVER", previous);
    }
  });

  test("throws when RLS is on and the pool has no begin()", async () => {
    const previous = process.env.TENANCY_DRIVER;
    process.env.TENANCY_DRIVER = "rls";
    const restored = currentPoolOrNull();
    const pool = Object.assign(async () => [] as unknown[], {
      async close() {},
      async unsafe<T>() {
        return [] as T[];
      },
    });
    registerDefaultDatabasePool(pool as SqlDatabaseConnection);

    try {
      await expect(runWithMigrationBypass(async () => "ok")).rejects.toThrow(/supports begin/);
    } finally {
      restorePool(restored);
      restoreEnvVar("TENANCY_DRIVER", previous);
    }
  });
});
