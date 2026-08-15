import { describe, expect, mock, test } from "bun:test";
import { CORE_AUTH_TOKEN } from "../../src/bootstrap/config";
import { ServiceContainer } from "../../src/bootstrap/contracts";
import { createHttpKernel } from "../../src/bootstrap/httpKernel";
import { CORE_VIEW_TOKEN } from "../../src/bootstrap/providers/view";
import { AuthManager, GuestGuard } from "../../src/core/auth/guard";
import { attachmentServiceToken } from "../../src/modules/attachment/provider";
import type { AttachmentRecord } from "../../src/modules/attachment/types";
import AttachmentWebController, {
  createAttachmentWebRoutes,
} from "../../src/modules/attachment/webController";
import { createMockCache, createMockDependencies } from "./testHelpers";

const now = new Date("2026-01-01T00:00:00.000Z");

const attachment: AttachmentRecord = {
  id: 1,
  task_id: 10,
  tenant_id: 1,
  user_id: 2,
  original_name: 'notes "draft".txt',
  storage_path: "attachments/task-10/notes.txt",
  mime_type: "text/plain",
  size_bytes: 5,
  created_at: now,
  deleted_at: null,
};

function createUploadRequest(url: string): Request {
  const formData = new FormData();
  formData.append("file", new File(["hello"], "notes.txt", { type: "text/plain" }));

  return new Request(url, { method: "POST", body: formData });
}

function createController(service: Record<string, unknown>): AttachmentWebController {
  const container = new ServiceContainer();
  container.set(attachmentServiceToken, service);
  container.set(CORE_VIEW_TOKEN, {
    render: mock(async (_template: string, context: Record<string, unknown>) =>
      JSON.stringify(context),
    ),
  });

  const cacheFlush = mock(async () => 0);

  return new AttachmentWebController(
    createMockDependencies(
      container,
      createMockCache({
        tags: () => ({ remember: async (_key, callback) => callback(), flush: cacheFlush }),
      }),
    ),
  );
}

describe("AttachmentWebController", () => {
  test("listForTask renders attachment lists for a task", async () => {
    const listByTaskId = mock(async () => [attachment]);
    const controller = createController({ listByTaskId });

    const response = await controller.listForTask({
      params: { id: "10" },
      headers: new Headers(),
    } as never);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    expect(await response.text()).toContain('"taskId":10');
  });

  test("storeForTask uploads attachments and re-renders the list", async () => {
    const create = mock(async () => attachment);
    const listByTaskId = mock(async () => [attachment]);
    const controller = createController({ create, listByTaskId });

    const response = await controller.storeForTask(
      Object.assign(createUploadRequest("http://example.test/tasks/10/attachments"), {
        params: { id: "10" },
      }) as never,
    );

    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalled();
    expect(listByTaskId).toHaveBeenCalled();
  });

  test("download returns attachment contents", async () => {
    const readContents = mock(async () => ({
      attachment,
      contents: new Uint8Array([104, 101, 108, 108, 111]),
    }));
    const controller = createController({ readContents });

    const response = await controller.download({
      params: { id: "1" },
      headers: new Headers(),
    } as never);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="notes draft.txt"',
    );
    expect(await response.text()).toBe("hello");
  });

  test("destroy redirects to the task page for non-htmx requests", async () => {
    const findByIdOrThrow = mock(async () => attachment);
    const deleteAttachment = mock(async () => undefined);
    const controller = createController({
      findByIdOrThrow,
      delete: deleteAttachment,
    });

    const response = await controller.destroy({
      params: { id: "1" },
      headers: new Headers(),
    } as never);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/tasks/10");
  });

  test("destroy re-renders attachment lists for htmx requests", async () => {
    const findByIdOrThrow = mock(async () => attachment);
    const deleteAttachment = mock(async () => undefined);
    const listByTaskId = mock(async () => []);
    const controller = createController({
      findByIdOrThrow,
      delete: deleteAttachment,
      listByTaskId,
    });

    const response = await controller.destroy({
      params: { id: "1" },
      headers: new Headers({ "HX-Request": "true" }),
    } as never);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    expect(listByTaskId).toHaveBeenCalledWith(10);
  });

  test("createAttachmentWebRoutes registers web attachment endpoints", () => {
    const container = new ServiceContainer();
    container.set(CORE_AUTH_TOKEN, new AuthManager(new GuestGuard()));
    container.set(attachmentServiceToken, {});
    container.set(CORE_VIEW_TOKEN, { render: async () => "" });

    const dependencies = createMockDependencies(container, createMockCache());

    const kernel = createHttpKernel(dependencies);
    const routes = createAttachmentWebRoutes(dependencies, kernel);

    expect(routes["/tasks/:id/attachments"]).toBeDefined();
    expect(routes["/attachments/:id/download"]).toBeDefined();
    expect(routes["/attachments/:id"]).toBeDefined();
  });
});
