import { describe, expect, mock, test } from "bun:test";
import { ServiceContainer } from "../../src/bootstrap/contracts";
import AdminController from "../../src/modules/admin/controller";
import { adminServiceToken } from "../../src/modules/admin/provider";
import { createMockCache, createMockDependencies } from "./testHelpers";

describe("AdminController", () => {
  function createController(service: Record<string, unknown>): AdminController {
    const container = new ServiceContainer();
    container.set(adminServiceToken, service);

    return new AdminController(createMockDependencies(container, createMockCache()));
  }

  test("returns admin stats", async () => {
    const stats = mock(async () => ({
      user_count: 3,
      organization_count: 2,
      project_count: 4,
      task_count: 10,
      tenant_count: 1,
    }));

    const controller = createController({ stats });
    const response = await controller.stats();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      user_count: 3,
      organization_count: 2,
      project_count: 4,
      task_count: 10,
      tenant_count: 1,
    });
  });

  test("lists tenants and organization members", async () => {
    const listTenants = mock(async () => [{ id: 1, name: "Default", slug: "default" }]);
    const listOrganizationMembers = mock(async () => [
      {
        id: 1,
        organization_id: 5,
        user_id: 2,
        role: "owner",
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ]);

    const controller = createController({ listTenants, listOrganizationMembers });

    const tenantsResponse = await controller.tenants();
    expect(tenantsResponse.status).toBe(200);
    expect(await tenantsResponse.json()).toEqual({
      data: [{ id: 1, name: "Default", slug: "default" }],
    });

    const membersResponse = await controller.organizationMembers();
    expect(membersResponse.status).toBe(200);
    expect(await membersResponse.json()).toEqual({
      data: [
        {
          id: 1,
          organization_id: 5,
          user_id: 2,
          role: "owner",
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
  });

  test("returns feature flags", async () => {
    const featureFlags = mock(() => ({ mfa: true }));
    const controller = createController({ featureFlags });

    const response = await controller.features();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ mfa: true });
  });
});
