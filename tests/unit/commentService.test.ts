import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { runWithAuthUser } from "@getstrata/core/auth/authContext";
import { membershipContext } from "@getstrata/core/auth/membershipContext";
import type { DatabaseConnection } from "@getstrata/core/database/baseRepository";
import { NotFoundError } from "@getstrata/core/errors/http";
import { runWithTenant } from "@getstrata/core/tenant/tenantContext";
import type CommentRepository from "../../src/modules/comment/repository";
import type { CommentRecord } from "../../src/modules/comment/types";
import type OrganizationRepository from "../../src/modules/organization/repository";
import type { OrganizationRecord } from "../../src/modules/organization/types";
import type ProjectRepository from "../../src/modules/project/repository";
import type { ProjectRecord } from "../../src/modules/project/types";
import type TaskRepository from "../../src/modules/task/repository";
import type { TaskRecord } from "../../src/modules/task/types";
import { bindFakeTransactionConnection, resetFakeTransactionConnection } from "./testHelpers";

type CommentService = typeof import("../../src/modules/comment/service").default;

let CommentServiceClass: CommentService;

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

const comment: CommentRecord = {
  id: 30,
  task_id: 20,
  tenant_id: 1,
  body: "Looks good.",
  created_at: now,
  deleted_at: null,
};

class FakeCommentRepository
  implements
    Pick<
      CommentRepository,
      | "paginate"
      | "findByIdOrThrow"
      | "create"
      | "updateByIdOrThrow"
      | "deleteById"
      | "withConnection"
    >
{
  paginate = async () => ({
    data: [comment],
    meta: { page: 1, per_page: 10, total: 1, last_page: 1 },
  });

  findByIdOrThrow = async (id: number, onMissing?: (commentId: number) => Error) => {
    if (id !== comment.id) {
      throw onMissing?.(id) ?? new NotFoundError(`Comment ${id} not found.`);
    }

    return comment;
  };

  create = async (input: Omit<CommentRecord, "id" | "deleted_at">) => ({
    id: 99,
    deleted_at: null,
    ...input,
  });

  updateByIdOrThrow = async (
    id: number,
    changes: Partial<CommentRecord>,
    onMissing?: (commentId: number) => Error,
  ) => {
    if (id !== comment.id) {
      throw onMissing?.(id) ?? new NotFoundError(`Comment ${id} not found.`);
    }

    return {
      ...comment,
      ...changes,
      id,
    };
  };

  deleteById = async (id: number) => id === comment.id;

  withConnection(_connection: DatabaseConnection) {
    return this as never;
  }
}

class FakeTaskRepository implements Pick<TaskRepository, "findById" | "withConnection"> {
  findById = async (id: number) => (id === task.id ? task : null);

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
    commentRepository?: Partial<FakeCommentRepository>;
    taskRepository?: Partial<FakeTaskRepository>;
    projectRepository?: Partial<FakeProjectRepository>;
    organizationRepository?: Partial<FakeOrganizationRepository>;
  } = {},
) {
  return new CommentServiceClass(
    Object.assign(new FakeCommentRepository(), overrides.commentRepository) as never,
    Object.assign(new FakeTaskRepository(), overrides.taskRepository) as never,
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
  ({ default: CommentServiceClass } = await import("../../src/modules/comment/service"));
});

beforeEach(() => {
  bindFakeTransactionConnection();
});

afterEach(() => {
  resetFakeTransactionConnection();
});

describe("CommentService", () => {
  test("paginates comments globally for unrestricted users", async () => {
    const service = createService();

    await runWithAuthUser({ id: 1, role: "admin" }, async () => {
      const result = await service.paginate({ page: 1, perPage: 10 });
      expect(result.data).toEqual([comment]);
    });
  });

  test("paginates comments for accessible organizations", async () => {
    const service = createService({
      projectRepository: {
        findIdsByOrganizationIds: async () => [project.id],
      },
    });

    await withMembership([5], async () => {
      const result = await service.paginate({ page: 1, perPage: 10 });
      expect(result.data).toEqual([comment]);
    });
  });

  test("returns empty pages when members cannot access any projects", async () => {
    const service = createService({
      projectRepository: {
        findIdsByOrganizationIds: async () => [],
      },
    });

    await withMembership([], async () => {
      const global = await service.paginate({ page: 1, perPage: 10 });
      expect(global.data).toEqual([]);

      const byTask = await service.paginateByTaskId(task.id, { page: 1, perPage: 10 });
      expect(byTask.data).toEqual([]);
    });
  });

  test("paginates comments for accessible tasks", async () => {
    const service = createService();

    await withMembership([5], async () => {
      const result = await service.paginateByTaskId(task.id, { page: 1, perPage: 10 });
      expect(result.data).toEqual([comment]);
    });
  });

  test("returns empty pages for missing or inaccessible tasks", async () => {
    const missingTask = createService({
      taskRepository: { findById: async () => null },
    });

    await withMembership([5], async () => {
      const result = await missingTask.paginateByTaskId(task.id, { page: 1, perPage: 10 });
      expect(result.data).toEqual([]);
    });
  });

  test("findByIdOrThrow validates tenant and task access", async () => {
    const service = createService();

    await runWithTenant({ id: 1, slug: "acme", plan: "free", region: "eu" }, async () => {
      await withMembership([5], async () => {
        const found = await service.findByIdOrThrow(comment.id);
        expect(found.organization_id).toBe(5);
      });
    });

    await expect(service.findByIdOrThrow(404)).rejects.toThrow("Comment 404 not found.");

    const missingTask = createService({
      taskRepository: { findById: async () => null },
    });
    await expect(missingTask.findByIdOrThrow(comment.id)).rejects.toThrow(
      `Comment ${comment.id} not found.`,
    );

    await runWithTenant({ id: 2, slug: "other", plan: "free", region: "eu" }, async () => {
      await expect(service.findByIdOrThrow(comment.id)).rejects.toThrow(
        `Comment ${comment.id} not found.`,
      );
    });

    await runWithTenant({ id: 1, slug: "acme", plan: "free", region: "eu" }, async () => {
      await withMembership([99], async () => {
        await expect(service.findByIdOrThrow(comment.id)).rejects.toThrow(
          `Comment ${comment.id} not found.`,
        );
      });
    });
  });

  test("returns empty pages when the task project cannot be resolved", async () => {
    const service = createService({
      projectRepository: { findById: async () => null },
    });

    await withMembership([5], async () => {
      const result = await service.paginateByTaskId(task.id, { page: 1, perPage: 10 });
      expect(result.data).toEqual([]);
    });
  });

  test("create rejects comments for inaccessible or unresolved projects", async () => {
    const service = createService();

    await runWithTenant({ id: 1, slug: "acme", plan: "free", region: "eu" }, async () => {
      await withMembership([99], async () => {
        await expect(service.create({ task_id: task.id, body: "Nope" })).rejects.toThrow(
          `Task ${task.id} not found.`,
        );
      });
    });

    const missingProject = createService({
      projectRepository: {
        findById: async () => null,
        withConnection(_connection: DatabaseConnection) {
          return this as never;
        },
      } as never,
    });

    await runWithTenant({ id: 1, slug: "acme", plan: "free", region: "eu" }, async () => {
      await withMembership([5], async () => {
        await expect(
          missingProject.create({ task_id: task.id, body: "Missing project" }),
        ).rejects.toThrow(`Task ${task.id} not found.`);
      });
    });

    const missingOrganization = createService({
      organizationRepository: {
        findById: async () => null,
        withConnection(_connection: DatabaseConnection) {
          return this as never;
        },
      } as never,
    });

    await runWithTenant({ id: 1, slug: "acme", plan: "free", region: "eu" }, async () => {
      await withMembership([5], async () => {
        await expect(
          missingOrganization.create({ task_id: task.id, body: "Missing organization" }),
        ).rejects.toThrow(`Task ${task.id} not found.`);
      });
    });
  });

  test("create persists comments for accessible tasks", async () => {
    const service = createService();

    await runWithTenant({ id: 1, slug: "acme", plan: "free", region: "eu" }, async () => {
      await withMembership([5], async () => {
        const created = await service.create({ task_id: task.id, body: "Ship it." });
        expect(created.body).toBe("Ship it.");
        expect(created.task_id).toBe(task.id);
      });
    });

    const inaccessibleTask = createService({
      taskRepository: { findById: async () => null },
    });
    await expect(inaccessibleTask.create({ task_id: 999, body: "Missing task" })).rejects.toThrow(
      "Task 999 not found.",
    );
  });

  test("update and delete comments through the repository", async () => {
    const service = createService();

    const updated = await service.update(comment.id, { body: "Updated body" });
    expect(updated.body).toBe("Updated body");

    await expect(service.update(404, { body: "Missing" })).rejects.toThrow(
      "Comment 404 not found.",
    );

    await expect(service.delete(comment.id)).resolves.toBeUndefined();
    await expect(service.delete(404)).rejects.toThrow("Comment 404 not found.");
  });
});
