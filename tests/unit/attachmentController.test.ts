import { afterEach, describe, expect, mock, test } from "bun:test";
import { setActiveApplicationContext } from "../../src/bootstrap/applicationRegistry";
import { CORE_AUTH_TOKEN, CORE_POLICY_GATE_TOKEN } from "../../src/bootstrap/config";
import { type AppDependencies, ConfigStore, ServiceContainer } from "../../src/bootstrap/contracts";
import { createHttpKernel } from "../../src/bootstrap/httpKernel";
import { AuthManager, GuestGuard } from "../../src/core/auth/guard";
import { membershipContext } from "../../src/core/auth/membershipContext";
import { PolicyGate } from "../../src/core/auth/policy";
import AttachmentController, {
  createAttachmentRoutes,
} from "../../src/modules/attachment/controller";
import AttachmentPolicy from "../../src/modules/attachment/policy";
import { attachmentServiceToken } from "../../src/modules/attachment/provider";
import type { AttachmentRecord } from "../../src/modules/attachment/types";
import { tokenServiceToken } from "../../src/modules/user/provider";
import { createMockCache, createMockDependencies } from "./testHelpers";

const now = new Date("2026-01-01T00:00:00.000Z");

const attachment: AttachmentRecord & { organization_id: number } = {
  id: 1,
  task_id: 10,
  tenant_id: 1,
  user_id: 2,
  original_name: 'report "final".txt',
  storage_path: "attachments/task-10/report.txt",
  mime_type: "text/plain",
  size_bytes: 5,
  created_at: now,
  deleted_at: null,
  organization_id: 5,
};

function createUploadRequest(url: string): Request {
  const formData = new FormData();
  formData.append("file", new File(["hello"], "notes.txt", { type: "text/plain" }));

  return new Request(url, { method: "POST", body: formData });
}

function bootstrapDependencies(service: Record<string, unknown>): AppDependencies {
  const container = new ServiceContainer();
  const gate = new PolicyGate();
  gate.register("attachment", new AttachmentPolicy());

  container.set(CORE_AUTH_TOKEN, new AuthManager(new GuestGuard()));
  container.set(CORE_POLICY_GATE_TOKEN, gate);
  container.set(attachmentServiceToken, service);
  container.set(tokenServiceToken, {
    resolveUserFromToken: async () => null,
  });

  const cacheFlush = mock(async () => 0);
  const dependencies = createMockDependencies(
    container,
    createMockCache({
      tags: () => ({ remember: async (_key, callback) => callback(), flush: cacheFlush }),
    }),
  );

  setActiveApplicationContext({
    container,
    config: new ConfigStore(),
    dependencies,
  });

  return dependencies;
}

function createController(service: Record<string, unknown>): AttachmentController {
  const dependencies = bootstrapDependencies(service);

  return new AttachmentController(dependencies, async (_key, loader) => {
    const data = await loader();
    return Response.json(data);
  });
}

function withMembership<T>(callback: () => T | Promise<T>): T | Promise<T> {
  return membershipContext.run(
    {
      organizationIds: [5],
      rolesByOrganizationId: new Map([[5, "member"]]),
    },
    callback,
  );
}

describe("AttachmentController", () => {
  afterEach(() => {
    delete process.env.FEATURE_PUBLIC_READS;
  });

  test("byTask returns paginated attachment resources", async () => {
    const paginateByTaskId = mock(async () => ({
      data: [attachment],
      meta: { page: 1, per_page: 100, total: 1, last_page: 1 },
    }));
    const controller = createController({ paginateByTaskId });

    const response = await controller.byTask(
      Object.assign(new Request("http://example.test/tasks/10/attachments"), {
        params: { id: "10" },
      }) as never,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: [
        {
          id: 1,
          task_id: 10,
          user_id: 2,
          original_name: 'report "final".txt',
          mime_type: "text/plain",
          size_bytes: 5,
          download_url: "/api/v1/attachments/1/download",
          created_at: now.toISOString(),
        },
      ],
      meta: { page: 1, per_page: 100, total: 1, last_page: 1 },
    });
  });

  test("storeForTask uploads attachments and flushes cache", async () => {
    const create = mock(async () => attachment);
    const controller = createController({ create });

    const response = await controller.storeForTask(
      Object.assign(createUploadRequest("http://example.test/tasks/10/attachments"), {
        params: { id: "10" },
      }) as never,
    );

    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalled();
  });

  test("show returns a single attachment resource", async () => {
    process.env.FEATURE_PUBLIC_READS = "true";

    const findByIdOrThrow = mock(async () => attachment);
    const controller = createController({ findByIdOrThrow });

    const response = await withMembership(() =>
      controller.show({
        params: { id: "1" },
        headers: new Headers({
          "x-authenticated-user-id": "2",
          "x-authenticated-user-role": "member",
        }),
      } as never),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: 1, task_id: 10 });
  });

  test("download returns attachment contents with sanitized filename", async () => {
    process.env.FEATURE_PUBLIC_READS = "true";

    const findByIdOrThrow = mock(async () => attachment);
    const readContents = mock(async () => ({
      attachment,
      contents: new Uint8Array([104, 101, 108, 108, 111]),
    }));
    const controller = createController({ findByIdOrThrow, readContents });

    const response = await withMembership(() =>
      controller.download({
        params: { id: "1" },
        headers: new Headers({
          "x-authenticated-user-id": "2",
          "x-authenticated-user-role": "member",
        }),
      } as never),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/plain");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="report final.txt"',
    );
    expect(await response.text()).toBe("hello");
  });

  test("destroy deletes attachments and returns no content", async () => {
    process.env.FEATURE_PUBLIC_READS = "true";

    const deleteAttachment = mock(async () => undefined);
    const findByIdOrThrow = mock(async () => attachment);
    const controller = createController({
      findByIdOrThrow,
      delete: deleteAttachment,
    });

    const response = await withMembership(() =>
      controller.destroy({
        params: { id: "1" },
        headers: new Headers({
          "x-authenticated-user-id": "2",
          "x-authenticated-user-role": "member",
        }),
      } as never),
    );

    expect(response.status).toBe(204);
    expect(deleteAttachment).toHaveBeenCalledWith(1);
  });

  test("createAttachmentRoutes registers attachment endpoints", () => {
    const dependencies = bootstrapDependencies({});
    const kernel = createHttpKernel(dependencies);
    const routes = createAttachmentRoutes(
      dependencies,
      async (_key, loader) => Response.json(await loader()),
      kernel,
    );

    expect(routes["/attachments/:id"]).toBeDefined();
    expect(routes["/attachments/:id/download"]).toBeDefined();
    expect(routes["/tasks/:id/attachments"]).toBeDefined();
  });
});
