import { afterAll, describe, expect, mock, test } from "bun:test";
import { CORE_AUTH_TOKEN, CORE_POLICY_GATE_TOKEN } from "@getstrata/bootstrap/config";
import { ServiceContainer } from "@getstrata/bootstrap/contracts";
import { AuthManager, GuestGuard } from "@getstrata/core/auth/guard";
import { PolicyGate } from "@getstrata/core/auth/policy";
import { etagFromResource, jsonResponse } from "@getstrata/core/http";
import { setActiveApplicationContext } from "@getstrata/core/runtime/applicationRegistry";
import TaskController from "../../src/modules/task/controller";
import TaskPolicy from "../../src/modules/task/policy";
import { taskServiceToken } from "../../src/modules/task/provider";
import type { TaskWithProjectRecord } from "../../src/modules/task/types";
import { createMockCache, createMockDependencies } from "./testHelpers";

const now = new Date("2026-01-01T00:00:00.000Z");

const task: TaskWithProjectRecord = {
  id: 20,
  project_id: 10,
  tenant_id: 1,
  title: "Ship release",
  status: "todo",
  priority: 2,
  created_at: now,
  updated_at: now,
  deleted_at: null,
  project: {
    id: 10,
    name: "Platform",
    organization_id: 5,
  },
};

function bootstrapController(service: Record<string, unknown>): TaskController {
  const container = new ServiceContainer();
  const gate = new PolicyGate();
  gate.register("task", new TaskPolicy());
  container.set(CORE_AUTH_TOKEN, new AuthManager(new GuestGuard()));
  container.set(CORE_POLICY_GATE_TOKEN, gate);
  container.set(taskServiceToken, service);

  const dependencies = createMockDependencies(container, createMockCache());
  setActiveApplicationContext({
    container,
    config: { get: () => undefined, set: () => undefined, has: () => false } as never,
    dependencies,
  });

  return new TaskController(dependencies, async (_key, callback) => jsonResponse(await callback()));
}

describe("TaskController", () => {
  test("lists tasks through the cache wrapper", async () => {
    const paginate = mock(async () => ({
      data: [task],
      meta: { page: 1, per_page: 10, total: 1, last_page: 1 },
    }));

    const controller = bootstrapController({ paginate });
    const response = await controller.index(new Request("http://example.test/tasks?page=1"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: [{ id: 20, title: "Ship release" }],
    });
  });

  test("shows, updates, and deletes tasks through secured handlers", async () => {
    const findByIdOrThrow = mock(async () => task);
    const update = mock(async () => ({ ...task, title: "Updated" }));
    const destroy = mock(async () => undefined);

    const controller = bootstrapController({ findByIdOrThrow, update, delete: destroy });
    const etag = etagFromResource(task);

    const showResponse = await controller.show({
      params: { id: "20" },
      headers: new Headers({
        "x-authenticated-user-id": "1",
        "x-authenticated-user-role": "admin",
      }),
    } as never);

    expect(showResponse.status).toBe(200);

    const updateResponse = await controller.update({
      params: { id: "20" },
      headers: new Headers({
        "x-authenticated-user-id": "1",
        "x-authenticated-user-role": "admin",
        "content-type": "application/json",
        "if-match": etag,
      }),
      json: async () => ({ title: "Updated" }),
    } as never);

    expect(updateResponse.status).toBe(200);
    expect(update).toHaveBeenCalled();

    const deleteResponse = await controller.destroy({
      params: { id: "20" },
      headers: new Headers({
        "x-authenticated-user-id": "1",
        "x-authenticated-user-role": "admin",
        "if-match": etag,
      }),
    } as never);

    expect(deleteResponse.status).toBe(204);
    expect(destroy).toHaveBeenCalledWith(20);
  });

  test("creates tasks from request bodies", async () => {
    const create = mock(async () => task);
    const controller = bootstrapController({ create });

    const response = await controller.store(
      new Request("http://example.test/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          project_id: 10,
          title: "Ship release",
          priority: 2,
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalled();
  });
});

afterAll(() => {
  mock.restore();
});
