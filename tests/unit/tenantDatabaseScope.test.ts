import { describe, expect, test } from "bun:test";
import type { SqlDatabaseConnection } from "@getstrata/core/database/baseRepository";
import {
  getDefaultDatabasePool,
  registerDefaultDatabasePool,
  resetDefaultDatabasePoolForTests,
} from "@getstrata/core/database/defaultConnection";
import { currentTenant, currentTenantId } from "@getstrata/core/tenant/tenantContext";
import {
  isInsideTenantDatabaseScope,
  runWithTenantDatabase,
} from "@getstrata/core/tenant/tenantDatabaseScope";
import { getDatabase } from "../../src/db/connection";
import { restoreEnvVar } from "../helpers/restoreEnv";
import { defaultTestTenant } from "./testHelpers";

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

describe("runWithTenantDatabase", () => {
  test("sets application tenant context for the callback", async () => {
    await runWithTenantDatabase(defaultTestTenant, async () => {
      expect(currentTenant()).toEqual(defaultTestTenant);
      expect(currentTenantId()).toBe(1);
    });

    expect(currentTenant()).toBeNull();
  });

  test("reuses the active connection instead of opening nested transactions", async () => {
    const { hasActiveDatabaseConnection } = await import(
      "@getstrata/core/database/connectionContext"
    );

    await runWithTenantDatabase(defaultTestTenant, async () => {
      expect(hasActiveDatabaseConnection()).toBe(true);
      expect(isInsideTenantDatabaseScope()).toBe(true);
      expect(isInsideTenantDatabaseScope(99)).toBe(false);

      await runWithTenantDatabase(defaultTestTenant, async () => {
        expect(hasActiveDatabaseConnection()).toBe(true);
        expect(currentTenantId()).toBe(1);
        expect(isInsideTenantDatabaseScope()).toBe(true);
      });
    });

    expect(isInsideTenantDatabaseScope()).toBe(false);
  });

  test("skips SET LOCAL when TENANCY_DRIVER=none", async () => {
    const previous = process.env.TENANCY_DRIVER;
    process.env.TENANCY_DRIVER = "none";

    try {
      await runWithTenantDatabase(defaultTestTenant, async () => {
        expect(currentTenant()).toEqual(defaultTestTenant);
      });
    } finally {
      restoreEnvVar("TENANCY_DRIVER", previous);
    }
  });

  test("skips SET LOCAL when TENANCY_DRIVER=column", async () => {
    const previous = process.env.TENANCY_DRIVER;
    process.env.TENANCY_DRIVER = "column";

    try {
      await runWithTenantDatabase(defaultTestTenant, async () => {
        expect(currentTenant()).toEqual(defaultTestTenant);
      });
    } finally {
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
      await expect(runWithTenantDatabase(defaultTestTenant, async () => "ok")).rejects.toThrow(
        /RLS tenant scope requires a pool that supports begin/,
      );
    } finally {
      restorePool(restored);
      restoreEnvVar("TENANCY_DRIVER", previous);
    }
  });
});
