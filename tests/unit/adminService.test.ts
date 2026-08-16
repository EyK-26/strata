import { afterAll, describe, expect, mock, test } from "bun:test";
import { AdminResourceRegistry } from "@getstrata/core";
import { Job } from "@getstrata/core/queue";
import AdminService from "../../src/modules/admin/service";

class EchoJob extends Job<{ marker: string }> {
  override readonly maxAttempts = 1;

  override async handle(): Promise<void> {
    // no-op
  }
}

describe("AdminService", () => {
  test("returns aggregate stats and tenant summaries", async () => {
    const service = new AdminService();

    const stats = await service.stats();
    expect(stats.user_count).toBeGreaterThan(0);
    expect(stats.tenant_count).toBeGreaterThan(0);

    const tenants = await service.listTenants();
    expect(tenants.some((tenant) => tenant.slug === "default")).toBe(true);

    const members = await service.listOrganizationMembers(10);
    expect(Array.isArray(members)).toBe(true);
    if (members[0]) {
      expect(members[0].created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });

  test("returns feature flags and paginated audit logs", async () => {
    const service = new AdminService();

    expect(service.featureFlags()).toBeDefined();

    const auditLogs = await service.paginateAuditLogs({ page: 1, perPage: 5 });
    expect(auditLogs.meta.page).toBe(1);
    expect(Array.isArray(auditLogs.data)).toBe(true);
  });

  test("lists and retries failed jobs through the registry", async () => {
    const failedJobs = {
      listRecent: mock(async () => [
        {
          id: 1,
          job_name: "echo.job",
          payload: { marker: "x" },
          exception: "boom",
          failed_at: new Date(),
        },
      ]),
      retry: mock(async () => ({
        id: 1,
        job_name: "echo.job",
        payload: { marker: "x" },
        exception: "boom",
        failed_at: new Date(),
      })),
      recordFailure: mock(async () => ({
        id: 2,
        job_name: "echo.job",
        payload: {},
        exception: "boom",
        failed_at: new Date(),
      })),
    };

    const { jobRegistry } = await import("../../src/core/queue/jobRegistry");
    jobRegistry.register("echo.job", () => new EchoJob());

    const service = new AdminService(failedJobs as never);

    await expect(service.listFailedJobs()).resolves.toHaveLength(1);
    await expect(service.retryFailedJob(1)).resolves.toMatchObject({ job_name: "echo.job" });
  });

  test("throws when retrying an unknown failed job type", async () => {
    const failedJobs = {
      retry: mock(async () => ({
        id: 1,
        job_name: "missing.job",
        payload: {},
        exception: "boom",
        failed_at: new Date(),
      })),
    };

    const service = new AdminService(failedJobs as never);

    await expect(service.retryFailedJob(1)).rejects.toThrow('Unknown job "missing.job".');
  });

  test("deletes failed jobs", async () => {
    const failedJobs = {
      delete: mock(async () => undefined),
    };

    const service = new AdminService(failedJobs as never);
    await expect(service.deleteFailedJob(9)).resolves.toBeUndefined();
    expect(failedJobs.delete).toHaveBeenCalledWith(9);
  });

  test("lists registered admin resources", () => {
    const resources = new AdminResourceRegistry();
    resources.register({
      name: "users",
      label: "User",
      labelPlural: "Users",
      columns: [{ key: "id" as const, label: "ID" }],
      handlers: {
        paginate: async () => ({
          data: [],
          meta: { page: 1, per_page: 10, total: 0, last_page: 1 },
        }),
      },
    });

    const service = new AdminService(undefined as never, undefined as never, resources);
    expect(service.listResources()).toEqual([
      {
        name: "users",
        label: "User",
        labelPlural: "Users",
        columns: [{ key: "id" as const, label: "ID" }],
      },
    ]);
  });

  test("paginates and finds admin resource records", async () => {
    const resources = new AdminResourceRegistry();
    resources.register({
      name: "users",
      label: "User",
      labelPlural: "Users",
      columns: [{ key: "id" as const, label: "ID" }],
      handlers: {
        paginate: async () => ({
          data: [{ id: 7 }],
          meta: { page: 1, per_page: 10, total: 1, last_page: 1 },
        }),
        findById: async (id: number) => (id === 7 ? { id: 7 } : null),
      },
    });

    const service = new AdminService(undefined as never, undefined as never, resources);

    await expect(
      service.paginateResource("users", { page: 1, perPage: 10 }),
    ).resolves.toMatchObject({
      data: [{ id: 7 }],
    });
    await expect(service.findResourceRecord("users", 7)).resolves.toMatchObject({
      record: { id: 7 },
    });
    expect(() => service.paginateResource("missing", { page: 1, perPage: 10 })).toThrow(
      'Admin resource "missing" not found.',
    );
    await expect(service.findResourceRecord("users", 99)).rejects.toThrow("User 99 not found.");
  });

  test("rejects resource lookups when findById is unavailable", async () => {
    const resources = new AdminResourceRegistry();
    resources.register({
      name: "users",
      label: "User",
      labelPlural: "Users",
      columns: [{ key: "id" as const, label: "ID" }],
      handlers: {
        paginate: async () => ({
          data: [],
          meta: { page: 1, per_page: 10, total: 0, last_page: 1 },
        }),
      },
    });

    const service = new AdminService(undefined as never, undefined as never, resources);
    await expect(service.findResourceRecord("users", 1)).rejects.toThrow(
      'Admin resource "users" not found.',
    );
  });

  test("formats resource values through the admin formatter", () => {
    const service = new AdminService(
      undefined as never,
      undefined as never,
      new AdminResourceRegistry(),
    );
    expect(service.formatResourceValue(true, "boolean")).toBe("yes");
  });
});

afterAll(() => {
  mock.restore();
});
