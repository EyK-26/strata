import { beforeAll, describe, expect, test } from "bun:test";
import { setActiveApplicationContext } from "../../src/bootstrap/applicationRegistry";
import { CORE_QUEUE_TOKEN } from "../../src/bootstrap/config";
import { ConfigStore, ServiceContainer } from "../../src/bootstrap/contracts";
import { SyncQueue } from "../../src/core/queue/index";
import { runWithTenantDatabase } from "../../src/core/tenant/tenantDatabaseScope";
import UserRepository from "../../src/modules/user/repository";
import { createMockCache, defaultTestTenant } from "./testHelpers";

beforeAll(async () => {
  const container = new ServiceContainer();
  container.set(CORE_QUEUE_TOKEN, new SyncQueue());

  setActiveApplicationContext({
    container,
    config: new ConfigStore(),
    dependencies: {
      container,
      cache: createMockCache(),
    },
  });
});

describe("UserRepository", () => {
  test("finds seeded users by email and id", async () => {
    await runWithTenantDatabase(defaultTestTenant, async () => {
      const repository = new UserRepository();

      const admin = await repository.findByEmail("admin@workhub.test");
      expect(admin).not.toBeNull();
      if (!admin) {
        return;
      }
      expect(admin.email).toBe("admin@workhub.test");

      const byId = await repository.findById(admin.id);
      expect(byId?.email).toBe("admin@workhub.test");
    });
  });

  test("creates and updates users with protected emails", async () => {
    await runWithTenantDatabase(defaultTestTenant, async () => {
      const repository = new UserRepository();

      const created = await repository.create({
        name: "Coverage User",
        email: `coverage.user.${Date.now()}@workhub.test`,
        role: "member",
        created_at: new Date(),
        updated_at: new Date(),
      });

      expect(created.email).toContain("@workhub.test");

      const updated = await repository.updateByIdOrThrow(created.id, {
        email: `coverage.updated.${Date.now()}@workhub.test`,
      });

      expect(updated.email).toContain("@workhub.test");
    });
  });

  test("requires email when creating users", async () => {
    await runWithTenantDatabase(defaultTestTenant, async () => {
      const repository = new UserRepository();

      await expect(
        repository.create({
          name: "Missing Email",
          role: "member",
          created_at: new Date(),
          updated_at: new Date(),
        }),
      ).rejects.toThrow("Email is required.");
    });
  });
});
