import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { BadRequestError, NotFoundError } from "@getstrata/core/errors/http";
import { runWithAuthUser } from "../../src/core/auth/authContext";
import { membershipContext } from "../../src/core/auth/membershipContext";
import type { DatabaseConnection } from "../../src/core/database";
import { runWithTenant } from "../../src/core/tenant/tenantContext";
import type OrganizationRepository from "../../src/modules/organization/repository";
import type { OrganizationRecord } from "../../src/modules/organization/types";
import type ProjectRepository from "../../src/modules/project/repository";
import type { ProjectRecord } from "../../src/modules/project/types";
import type TaskRepository from "../../src/modules/task/repository";
import type { TaskRecord, TaskWithProjectRecord } from "../../src/modules/task/types";
import { bindFakeTransactionConnection, resetFakeTransactionConnection } from "./testHelpers";

type TaskService = typeof import("../../src/modules/task/service").default;

let TaskServiceClass: TaskService;

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

const task: TaskRecord = {
  id: 20,
  project_id: 10,
  tenant_id: 1,
  title: "Ship release",
  status: "todo",
  priority: 2,
  created_at: now,
  updated_at: now,
  deleted_at: null,
};

class FakeTaskRepository
  implements
    Pick<
      TaskRepository,
      | "paginate"
      | "findByIdOrThrow"
      | "attachProjects"
      | "create"
      | "updateByIdOrThrow"
      | "deleteById"
      | "withConnection"
    >
{
  paginate = async () => ({
    data: [task],
    meta: { page: 1, per_page: 10, total: 1, last_page: 1 },
  });

  findByIdOrThrow = async (id: number, onMissing?: (taskId: number) => Error) => {
    if (id !== task.id) {
      throw onMissing?.(id) ?? new NotFoundError(`Task ${id} not found.`);
    }

    return task;
  };

  attachProjects = async (tasks: readonly TaskRecord[]): Promise<TaskWithProjectRecord[]> =>
    tasks.map((record) => ({
      ...record,
      project: {
        id: project.id,
        name: project.name,
        organization_id: project.organization_id,
      },
    }));

  create = async (input: Omit<TaskRecord, "id" | "deleted_at">) => ({
    id: 99,
    deleted_at: null,
    ...input,
  });

  updateByIdOrThrow = async (
    id: number,
    changes: Partial<TaskRecord>,
    onMissing?: (taskId: number) => Error,
  ) => {
    if (id !== task.id) {
      throw onMissing?.(id) ?? new NotFoundError(`Task ${id} not found.`);
    }

    return {
      ...task,
      ...changes,
      id,
    };
  };

  deleteById = async (id: number) => id === task.id;

  withConnection(_connection: DatabaseConnection) {
    return this as never;
  }
}

class FakeProjectRepository
  implements Pick<ProjectRepository, "findById" | "findIdsByOrganizationIds" | "withConnection">
{
  findById = async (id: number) => (id === project.id ? project : null);

  findIdsByOrganizationIds = async () => [project.id];

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
    taskRepository?: Partial<FakeTaskRepository>;
    projectRepository?: Partial<FakeProjectRepository>;
    organizationRepository?: Partial<FakeOrganizationRepository>;
  } = {},
) {
  const tasks = Object.assign(new FakeTaskRepository(), overrides.taskRepository);
  const projects = Object.assign(new FakeProjectRepository(), overrides.projectRepository);
  const organizations = Object.assign(
    new FakeOrganizationRepository(),
    overrides.organizationRepository,
  );

  return new TaskServiceClass(
    tasks as unknown as ConstructorParameters<typeof TaskServiceClass>[0],
    projects as unknown as ConstructorParameters<typeof TaskServiceClass>[1],
    organizations as unknown as ConstructorParameters<typeof TaskServiceClass>[2],
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
  ({ default: TaskServiceClass } = await import("../../src/modules/task/service"));
});

beforeEach(() => {
  bindFakeTransactionConnection();
});

afterEach(() => {
  resetFakeTransactionConnection();
});

describe("TaskService", () => {
  test("paginates tasks for unrestricted users and attaches projects when requested", async () => {
    const service = createService();

    await runWithAuthUser({ id: 1, role: "admin" }, async () => {
      const plain = await service.paginate({ page: 1, perPage: 10, projectId: 10, status: "todo" });
      expect(plain.data).toEqual([task]);

      const withProject = await service.paginate({
        page: 1,
        perPage: 10,
        includeProject: true,
      });
      expect(withProject.data[0]?.project?.name).toBe("Platform");
    });
  });

  test("returns an empty page when the member has no accessible projects", async () => {
    const service = createService({
      projectRepository: {
        findIdsByOrganizationIds: async () => [],
      },
    });

    await withMembership([], async () => {
      const result = await service.paginate({ page: 2, perPage: 5, projectId: 10 });
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
        const found = await service.findByIdOrThrow(task.id);
        expect(found.id).toBe(task.id);

        const withProject = await service.findByIdOrThrow(task.id, { includeProject: true });
        expect(withProject.project?.name).toBe("Platform");
      });
    });

    await expect(service.findByIdOrThrow(404)).rejects.toThrow("Task 404 not found.");

    const missingProject = createService({
      projectRepository: { findById: async () => null },
    });
    await expect(missingProject.findByIdOrThrow(task.id)).rejects.toThrow(
      `Task ${task.id} not found.`,
    );

    const missingOrganization = createService({
      organizationRepository: { findById: async () => null },
    });
    await expect(missingOrganization.findByIdOrThrow(task.id)).rejects.toThrow(
      `Task ${task.id} not found.`,
    );

    await runWithTenant({ id: 2, slug: "other", plan: "free", region: "eu" }, async () => {
      await expect(service.findByIdOrThrow(task.id)).rejects.toThrow(`Task ${task.id} not found.`);
    });

    await runWithTenant({ id: 1, slug: "acme", plan: "free", region: "eu" }, async () => {
      await withMembership([99], async () => {
        await expect(service.findByIdOrThrow(task.id)).rejects.toThrow("Organization 5 not found.");
      });
    });
  });

  test("create validates priority and persists tasks in accessible projects", async () => {
    const service = createService();

    await runWithTenant({ id: 1, slug: "acme", plan: "free", region: "eu" }, async () => {
      await withMembership([5], async () => {
        const created = await service.create({
          project_id: project.id,
          title: "New task",
          priority: 4,
        });

        expect(created.title).toBe("New task");
        expect(created.priority).toBe(4);
        expect(created.status).toBe("todo");
      });
    });

    expect(() =>
      service.create({ project_id: project.id, title: "Bad priority", priority: 6 }),
    ).toThrow("Task priority must be between 0 and 5.");

    expect(() =>
      service.create({ project_id: project.id, title: "Bad priority", priority: -1 }),
    ).toThrow("Task priority must be between 0 and 5.");

    const missingProject = createService({
      projectRepository: { findById: async () => null },
    });
    await expect(
      missingProject.create({ project_id: 999, title: "Missing project" }),
    ).rejects.toThrow("Project 999 not found.");

    const missingOrganization = createService({
      organizationRepository: { findById: async () => null },
    });
    await expect(
      missingOrganization.create({ project_id: project.id, title: "Missing organization" }),
    ).rejects.toThrow(`Project ${project.id} not found.`);
  });

  test("scopes pagination to accessible projects for members", async () => {
    const service = createService({
      projectRepository: {
        findIdsByOrganizationIds: async () => [project.id],
      },
    });

    await withMembership([5], async () => {
      const allowed = await service.paginate({ page: 1, perPage: 10, projectId: project.id });
      expect(allowed.data).toEqual([task]);

      const scoped = await service.paginate({ page: 1, perPage: 10 });
      expect(scoped.data).toEqual([task]);

      const denied = await service.paginate({ page: 1, perPage: 10, projectId: 999 });
      expect(denied.data).toEqual([]);
    });
  });

  test("update accepts partial changes", async () => {
    const service = createService();

    const renamed = await service.update(task.id, { title: "Only renamed" });
    expect(renamed.title).toBe("Only renamed");
  });

  test("update validates status and priority before persisting changes", async () => {
    const service = createService();

    const updated = await service.update(task.id, {
      title: "Updated title",
      status: "done",
      priority: 1,
    });

    expect(updated.title).toBe("Updated title");
    expect(updated.status).toBe("done");
    expect(updated.priority).toBe(1);

    await expect(service.update(task.id, { status: "blocked" as "done" })).rejects.toThrow(
      BadRequestError,
    );
    await expect(service.update(task.id, { priority: -1 })).rejects.toThrow(BadRequestError);
    await expect(service.update(404, { title: "Missing" })).rejects.toThrow("Task 404 not found.");
  });

  test("delete removes existing tasks and reports missing ones", async () => {
    const service = createService();

    await expect(service.delete(task.id)).resolves.toBeUndefined();
    await expect(service.delete(404)).rejects.toThrow("Task 404 not found.");
  });
});
