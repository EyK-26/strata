import { describe, expect, test } from "bun:test";
import { currentTenant, currentTenantId } from "@getstrata/core/tenant/tenantContext";
import {
  isInsideTenantDatabaseScope,
  runWithTenantDatabase,
} from "@getstrata/core/tenant/tenantDatabaseScope";
import { restoreEnvVar } from "../helpers/restoreEnv";
import { defaultTestTenant } from "./testHelpers";

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
});
