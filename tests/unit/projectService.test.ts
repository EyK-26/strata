import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { runWithAuthUser } from "@getstrata/core/auth/authContext";
import { membershipContext } from "@getstrata/core/auth/membershipContext";
import type { DatabaseConnection } from "@getstrata/core/database";
import { NotFoundError } from "@getstrata/core/errors/http";
import { runWithTenant } from "@getstrata/core/tenant/tenantContext";
import type OrganizationRepository from "../../src/modules/organization/repository";
import type { OrganizationRecord } from "../../src/modules/organization/types";
import type ProjectRepository from "../../src/modules/project/repository";
import type { ProjectRecord, ProjectWithOrganizationRecord } from "../../src/modules/project/types";
import { bindFakeTransactionConnection, resetFakeTransactionConnection } from "./testHelpers";

type ProjectService = typeof import("../../src/modules/project/service").default;

let ProjectServiceClass: ProjectService;

const now = new Date("2026-01-01T00:00:00.000Z");

const organization: OrganizationRecord = {
  id: 5,
  tenant_id: 1,
  name: "Acme Labs",
  slug: "acme-labs",
  created_at: now,
  updated_at: now,
  deleted_at: null,
};

const project: ProjectRecord = {
  id: 10,
  organization_id: 5,
  tenant_id: 1,
  name: "Platform",
  status: "active",
  created_at: now,
  updated_at: now,
  deleted_at: null,
};

class FakeProjectRepository
  implements
    Pick<
      ProjectRepository,
      | "paginate"
      | "findByIdOrThrow"
      | "attachOrganizations"
      | "create"
      | "updateByIdOrThrow"
      | "deleteById"
      | "withConnection"
    >
{
  paginate = async () => ({
    data: [project],
    meta: { page: 1, per_page: 10, total: 1, last_page: 1 },
  });

  findByIdOrThrow = async (id: number, onMissing?: (projectId: number) => Error) => {
    if (id !== project.id) {
      throw onMissing?.(id) ?? new NotFoundError(`Project ${id} not found.`);
    }

    return project;
  };

  attachOrganizations = async (
    projects: readonly ProjectRecord[],
  ): Promise<ProjectWithOrganizationRecord[]> =>
    projects.map((record) => ({
      ...record,
      organization: {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
      },
    }));

  create = async (input: Omit<ProjectRecord, "id" | "deleted_at">) => ({
    id: 99,
    deleted_at: null,
    ...input,
  });

  updateByIdOrThrow = async (
    id: number,
    changes: Partial<ProjectRecord>,
    onMissing?: (projectId: number) => Error,
  ) => {
    if (id !== project.id) {
      throw onMissing?.(id) ?? new NotFoundError(`Project ${id} not found.`);
    }

    return {
      ...project,
      ...changes,
      id,
    };
  };

  deleteById = async (id: number) => id === project.id;

  withConnection(_connection: DatabaseConnection) {
    return this as never;
  }
}

class FakeOrganizationRepository
  implements Pick<OrganizationRepository, "findById" | "withConnection">
{
  findById = async (id: number) => (id === organization.id ? organization : null);

  withConnection(_connection: DatabaseConnection) {
    return this as never;
  }
}

function createService(
  overrides: {
    projectRepository?: Partial<FakeProjectRepository>;
    organizationRepository?: Partial<FakeOrganizationRepository>;
  } = {},
) {
  return new ProjectServiceClass(
    Object.assign(new FakeProjectRepository(), overrides.projectRepository) as never,
    Object.assign(new FakeOrganizationRepository(), overrides.organizationRepository) as never,
  );
}

function withMembership<T>(
  organizationIds: number[],
  callback: () => T | Promise<T>,
): T | Promise<T> {
  return runWithAuthUser({ id: 2, role: "member" }, () =>
    membershipContext.run(
      {
        organizationIds,
        rolesByOrganizationId: new Map(organizationIds.map((id) => [id, "member" as const])),
      },
      callback,
    ),
  );
}

beforeAll(async () => {
  ({ default: ProjectServiceClass } = await import("../../src/modules/project/service"));
});

beforeEach(() => {
  bindFakeTransactionConnection();
});

afterEach(() => {
  resetFakeTransactionConnection();
});

describe("ProjectService", () => {
  test("paginates projects for unrestricted users and attaches organizations when requested", async () => {
    const service = createService();

    await runWithAuthUser({ id: 1, role: "admin" }, async () => {
      const plain = await service.paginate({
        page: 1,
        perPage: 10,
        organizationId: 5,
        status: "active",
      });
      expect(plain.data).toEqual([project]);

      const withOrganization = await service.paginate({
        page: 1,
        perPage: 10,
        includeOrganization: true,
      });
      expect(withOrganization.data[0]?.organization?.slug).toBe("acme-labs");
    });
  });

  test("returns an empty page when the member has no accessible organizations", async () => {
    const service = createService();

    await withMembership([], async () => {
      const result = await service.paginate({ page: 2, perPage: 5, organizationId: 5 });
      expect(result).toEqual({
        data: [],
        meta: { page: 2, per_page: 5, total: 0, last_page: 1 },
      });
    });
  });

  test("findByIdOrThrow validates tenant and organization access", async () => {
    const service = createService();

    await runWithTenant({ id: 1, slug: "acme", plan: "free", region: "eu" }, async () => {
      await withMembership([5], async () => {
        const found = await service.findByIdOrThrow(project.id);
        expect(found.organization_id).toBe(5);
        expect(found.organization).toBeUndefined();

        const withOrganization = await service.findByIdOrThrow(project.id, {
          includeOrganization: true,
        });
        expect(withOrganization.organization?.name).toBe("Acme Labs");
      });
    });

    await expect(service.findByIdOrThrow(404)).rejects.toThrow("Project 404 not found.");

    const missingOrganization = createService({
      organizationRepository: { findById: async () => null },
    });
    await expect(missingOrganization.findByIdOrThrow(project.id)).rejects.toThrow(
      `Project ${project.id} not found.`,
    );

    await runWithTenant({ id: 2, slug: "other", plan: "free", region: "eu" }, async () => {
      await expect(service.findByIdOrThrow(project.id)).rejects.toThrow(
        `Project ${project.id} not found.`,
      );
    });

    await runWithTenant({ id: 1, slug: "acme", plan: "free", region: "eu" }, async () => {
      await withMembership([99], async () => {
        await expect(service.findByIdOrThrow(project.id)).rejects.toThrow(
          "Organization 5 not found.",
        );
      });
    });
  });

  test("create persists projects in accessible organizations", async () => {
    const service = createService();

    await runWithTenant({ id: 1, slug: "acme", plan: "free", region: "eu" }, async () => {
      await withMembership([5], async () => {
        const created = await service.create({
          organization_id: organization.id,
          name: "New project",
        });

        expect(created.name).toBe("New project");
        expect(created.status).toBe("draft");
      });
    });

    const missingOrganization = createService({
      organizationRepository: { findById: async () => null },
    });
    await expect(
      missingOrganization.create({ organization_id: 999, name: "Missing org" }),
    ).rejects.toThrow("Organization 999 not found.");
  });

  test("update accepts partial changes", async () => {
    const service = createService();

    const renamed = await service.update(project.id, { name: "Only renamed" });
    expect(renamed.name).toBe("Only renamed");
  });

  test("update validates status before persisting changes", async () => {
    const service = createService();

    const updated = await service.update(project.id, {
      name: "Renamed project",
      status: "archived",
    });

    expect(updated.name).toBe("Renamed project");
    expect(updated.status).toBe("archived");

    await expect(service.update(project.id, { status: "blocked" as "archived" })).rejects.toThrow(
      "Invalid project status: blocked",
    );
    await expect(service.update(404, { name: "Missing" })).rejects.toThrow(
      "Project 404 not found.",
    );
  });

  test("delete removes existing projects and reports missing ones", async () => {
    const service = createService();

    await expect(service.delete(project.id)).resolves.toBeUndefined();
    await expect(service.delete(404)).rejects.toThrow("Project 404 not found.");
  });
});
