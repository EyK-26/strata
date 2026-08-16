import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { runWithAuthUser } from "@getstrata/core/auth/authContext";
import { membershipContext } from "@getstrata/core/auth/membershipContext";
import type { DatabaseConnection } from "@getstrata/core/database";
import { ForbiddenError, NotFoundError, UnauthorizedError } from "@getstrata/core/errors/http";
import { runWithTenant } from "@getstrata/core/tenant/tenantContext";
import type AttachmentRepository from "../../src/modules/attachment/repository";
import type { AttachmentRecord } from "../../src/modules/attachment/types";
import type OrganizationRepository from "../../src/modules/organization/repository";
import type { OrganizationRecord } from "../../src/modules/organization/types";
import type ProjectRepository from "../../src/modules/project/repository";
import type { ProjectRecord } from "../../src/modules/project/types";
import type TaskRepository from "../../src/modules/task/repository";
import type { TaskRecord } from "../../src/modules/task/types";
import { bindFakeTransactionConnection, resetFakeTransactionConnection } from "./testHelpers";

const storagePut = mock(async (_path: string, _contents: Uint8Array | string) => "stored");
const storageGet = mock(
  async (_path: string): Promise<Uint8Array | null> => new Uint8Array([104, 101, 108, 108, 111]),
);
const storageDelete = mock(async (_path: string) => true);

type AttachmentService = typeof import("../../src/modules/attachment/service").default;

let AttachmentServiceClass: AttachmentService;

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

const attachment: AttachmentRecord = {
  id: 30,
  task_id: 20,
  tenant_id: 1,
  user_id: 2,
  original_name: "notes.txt",
  storage_path: "attachments/task-20/notes.txt",
  mime_type: "text/plain",
  size_bytes: 5,
  created_at: now,
  deleted_at: null,
};

class FakeAttachmentRepository
  implements
    Pick<
      AttachmentRepository,
      | "findByTaskId"
      | "findByIdOrThrow"
      | "create"
      | "paginate"
      | "softDeleteById"
      | "withConnection"
    >
{
  findByTaskId = async (taskId: number) => (taskId === task.id ? [attachment] : []);

  findByIdOrThrow = async (id: number, onMissing?: (attachmentId: number) => Error) => {
    if (id !== attachment.id) {
      throw onMissing?.(id) ?? new NotFoundError(`Attachment ${id} not found.`);
    }

    return attachment;
  };

  create = async (input: Omit<AttachmentRecord, "id" | "deleted_at">) => ({
    id: 99,
    deleted_at: null,
    ...input,
  });

  paginate = async () => ({
    data: [attachment],
    meta: { page: 1, per_page: 10, total: 1, last_page: 1 },
  });

  softDeleteById = async (id: number) => id === attachment.id;

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

class FakeProjectRepository implements Pick<ProjectRepository, "findById" | "withConnection"> {
  findById = async (id: number) => (id === project.id ? project : null);

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
    attachmentRepository?: Partial<FakeAttachmentRepository>;
    taskRepository?: Partial<FakeTaskRepository>;
    projectRepository?: Partial<FakeProjectRepository>;
    organizationRepository?: Partial<FakeOrganizationRepository>;
  } = {},
) {
  return new AttachmentServiceClass(
    Object.assign(new FakeAttachmentRepository(), overrides.attachmentRepository) as never,
    Object.assign(new FakeTaskRepository(), overrides.taskRepository) as never,
    Object.assign(new FakeProjectRepository(), overrides.projectRepository) as never,
    Object.assign(new FakeOrganizationRepository(), overrides.organizationRepository) as never,
    {
      put: storagePut,
      get: storageGet,
      delete: storageDelete,
    } as never,
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
  mock.module("@getstrata/core/storage/storage", () => ({
    storage: () => ({
      put: storagePut,
      get: storageGet,
      delete: storageDelete,
    }),
  }));
  ({ default: AttachmentServiceClass } = await import("../../src/modules/attachment/service"));
});

beforeEach(() => {
  bindFakeTransactionConnection();
});

afterEach(() => {
  resetFakeTransactionConnection();
});

describe("AttachmentService", () => {
  test("listByTaskId returns attachments for accessible tasks", async () => {
    const service = createService();

    await withMembership([5], async () => {
      expect(await service.listByTaskId(task.id)).toEqual([attachment]);
    });
  });

  test("listByTaskId returns an empty list for inaccessible tasks", async () => {
    const service = createService();

    await withMembership([99], async () => {
      expect(await service.listByTaskId(task.id)).toEqual([]);
    });
  });

  test("findByIdOrThrow returns attachment with organization scope", async () => {
    const service = createService();

    await runWithTenant({ id: 1, slug: "acme", plan: "free", region: "eu" }, async () => {
      await withMembership([5], async () => {
        const found = await service.findByIdOrThrow(attachment.id);
        expect(found.organization_id).toBe(5);
      });
    });
  });

  test("findByIdOrThrow rejects missing attachments and scope violations", async () => {
    const service = createService();

    await expect(service.findByIdOrThrow(404)).rejects.toThrow("Attachment 404 not found.");

    const missingTask = createService({
      taskRepository: { findById: async () => null },
    });
    await expect(missingTask.findByIdOrThrow(attachment.id)).rejects.toThrow(
      `Attachment ${attachment.id} not found.`,
    );

    const missingProject = createService({
      projectRepository: { findById: async () => null },
    });
    await expect(missingProject.findByIdOrThrow(attachment.id)).rejects.toThrow(
      `Attachment ${attachment.id} not found.`,
    );

    await runWithTenant({ id: 2, slug: "other", plan: "free", region: "eu" }, async () => {
      await expect(service.findByIdOrThrow(attachment.id)).rejects.toThrow(
        `Attachment ${attachment.id} not found.`,
      );
    });

    await runWithTenant({ id: 1, slug: "acme", plan: "free", region: "eu" }, async () => {
      await withMembership([99], async () => {
        await expect(service.findByIdOrThrow(attachment.id)).rejects.toThrow(
          `Attachment ${attachment.id} not found.`,
        );
      });
    });
  });

  test("create requires authentication", () => {
    const service = createService();

    expect(() =>
      service.create({
        taskId: task.id,
        upload: {
          fileName: "notes.txt",
          mimeType: "text/plain",
          size: 5,
          contents: new Uint8Array([1]),
        },
      }),
    ).toThrow(UnauthorizedError);
  });

  test("create rejects inaccessible tasks and missing relations", async () => {
    const service = createService();
    const upload = {
      fileName: "notes.txt",
      mimeType: "text/plain",
      size: 5,
      contents: new Uint8Array([1]),
    };

    await runWithTenant({ id: 1, slug: "acme", plan: "free", region: "eu" }, async () => {
      await withMembership([99], async () => {
        await expect(service.create({ taskId: task.id, upload })).rejects.toThrow(ForbiddenError);
      });
    });

    const missingTask = createService({
      taskRepository: {
        findById: async () => null,
        withConnection(_connection: DatabaseConnection) {
          return this as never;
        },
      } as never,
    });

    await runWithAuthUser({ id: 2, role: "member" }, async () => {
      await expect(missingTask.create({ taskId: 999, upload })).rejects.toThrow(
        "Task 999 not found.",
      );
    });

    const missingProject = createService({
      projectRepository: {
        findById: async (id: number) => (id === project.id ? project : null),
        withConnection(_connection: DatabaseConnection) {
          return {
            findById: async () => null,
          } as never;
        },
      } as never,
    });

    await runWithTenant({ id: 1, slug: "acme", plan: "free", region: "eu" }, async () => {
      await withMembership([5], async () => {
        await expect(missingProject.create({ taskId: task.id, upload })).rejects.toThrow(
          `Task ${task.id} not found.`,
        );
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
        await expect(missingOrganization.create({ taskId: task.id, upload })).rejects.toThrow(
          `Task ${task.id} not found.`,
        );
      });
    });
  });

  test("create stores uploads for accessible tasks", async () => {
    const service = createService();
    const upload = {
      fileName: "notes.txt",
      mimeType: "text/plain",
      size: 5,
      contents: new Uint8Array([1, 2, 3]),
    };

    await runWithTenant({ id: 1, slug: "acme", plan: "free", region: "eu" }, async () => {
      await withMembership([5], async () => {
        const created = await service.create({ taskId: task.id, upload });
        expect(created.original_name).toBe("notes.txt");
        expect(created.task_id).toBe(task.id);
        expect(storagePut).toHaveBeenCalled();
      });
    });
  });

  test("readContents returns stored file contents", async () => {
    const service = createService();

    await runWithTenant({ id: 1, slug: "acme", plan: "free", region: "eu" }, async () => {
      await withMembership([5], async () => {
        const result = await service.readContents(attachment.id);
        expect(result.attachment.id).toBe(attachment.id);
        expect(result.contents).toEqual(new Uint8Array([104, 101, 108, 108, 111]));
      });
    });
  });

  test("readContents rejects missing storage objects", async () => {
    storageGet.mockImplementationOnce(async () => null);
    const service = createService();

    await runWithTenant({ id: 1, slug: "acme", plan: "free", region: "eu" }, async () => {
      await withMembership([5], async () => {
        await expect(service.readContents(attachment.id)).rejects.toThrow(
          `Attachment ${attachment.id} not found.`,
        );
      });
    });
  });

  test("delete soft-deletes attachments and removes storage files", async () => {
    const service = createService();

    await runWithTenant({ id: 1, slug: "acme", plan: "free", region: "eu" }, async () => {
      await withMembership([5], async () => {
        await expect(service.delete(attachment.id)).resolves.toBeUndefined();
        expect(storageDelete).toHaveBeenCalledWith(attachment.storage_path);
      });
    });
  });

  test("delete rejects attachments that were not soft-deleted", async () => {
    const service = createService({
      attachmentRepository: { softDeleteById: async () => false },
    });

    await runWithTenant({ id: 1, slug: "acme", plan: "free", region: "eu" }, async () => {
      await withMembership([5], async () => {
        await expect(service.delete(attachment.id)).rejects.toThrow(
          `Attachment ${attachment.id} not found.`,
        );
      });
    });
  });

  test("paginateByTaskId returns empty pages for inaccessible tasks", async () => {
    const service = createService();

    await withMembership([99], async () => {
      const result = await service.paginateByTaskId(task.id, { page: 1, perPage: 10 });
      expect(result.data).toEqual([]);
      expect(result.meta.total).toBe(0);
    });
  });

  test("paginateByTaskId returns paginated attachments for accessible tasks", async () => {
    const service = createService();

    await withMembership([5], async () => {
      const result = await service.paginateByTaskId(task.id, { page: 1, perPage: 10 });
      expect(result.data).toEqual([attachment]);
    });
  });

  test("canAccessTask allows unrestricted users and rejects missing projects", async () => {
    const service = createService();

    await runWithAuthUser({ id: 1, role: "admin" }, async () => {
      expect(await service.listByTaskId(task.id)).toEqual([attachment]);
    });

    const missingProject = createService({
      projectRepository: { findById: async () => null },
    });

    await withMembership([5], async () => {
      expect(await missingProject.listByTaskId(task.id)).toEqual([]);
    });
  });

  test("buildStoragePath generates task-scoped storage keys", async () => {
    const { buildStoragePath } = await import("../../src/modules/attachment/service");

    expect(buildStoragePath(task.id, "notes.txt")).toMatch(
      new RegExp(`^attachments/task-${task.id}/.+?-notes\\.txt$`),
    );
  });
});

afterAll(() => {
  mock.restore();
});
