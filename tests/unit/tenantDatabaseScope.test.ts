import { describe, expect, test } from "bun:test";
import { currentTenant, currentTenantId } from "@getstrata/core/tenant/tenantContext";
import {
  isInsideTenantDatabaseScope,
  runWithTenantDatabase,
} from "@getstrata/core/tenant/tenantDatabaseScope";
import { defaultTestTenant } from "./testHelpers";

describe("runWithTenantDatabase", () => {
  test("sets application tenant context and can read seeded users", async () => {
    await runWithTenantDatabase(defaultTestTenant, async () => {
      expect(currentTenant()).toEqual(defaultTestTenant);
      expect(currentTenantId()).toBe(1);

      const UserRepository = (await import("../../src/modules/user/repository")).default;
      const admin = await new UserRepository().findByEmail("admin@workhub.test");
      expect(admin?.email).toBe("admin@workhub.test");
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
});
