import { describe, expect, test } from "bun:test";
import { currentTenant, currentTenantId } from "../../src/core/tenant/tenantContext";
import { runWithTenantDatabase } from "../../src/core/tenant/tenantDatabaseScope";
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
});
