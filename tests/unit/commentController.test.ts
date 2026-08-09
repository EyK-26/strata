import { afterAll, describe, expect, mock, test } from "bun:test";
import { setActiveApplicationContext } from "../../src/bootstrap/applicationRegistry";
import { CORE_AUTH_TOKEN, CORE_POLICY_GATE_TOKEN } from "../../src/bootstrap/config";
import { ServiceContainer } from "../../src/bootstrap/contracts";
import { AuthManager, GuestGuard } from "../../src/core/auth/guard";
import { PolicyGate } from "../../src/core/auth/policy";
import { etagFromResource, jsonResponse } from "../../src/core/http";
import CommentController from "../../src/modules/comment/controller";
import CommentPolicy from "../../src/modules/comment/policy";
import { commentServiceToken } from "../../src/modules/comment/provider";
import type { CommentRecord } from "../../src/modules/comment/types";
import { createMockCache } from "./testHelpers";

const now = new Date("2026-01-01T00:00:00.000Z");

const comment: CommentRecord = {
  id: 30,
  task_id: 20,
  tenant_id: 1,
  body: "Looks good.",
  created_at: now,
  deleted_at: null,
};

function bootstrapController(service: Record<string, unknown>): CommentController {
  const container = new ServiceContainer();
  const gate = new PolicyGate();
  gate.register("comment", new CommentPolicy());
  container.set(CORE_AUTH_TOKEN, new AuthManager(new GuestGuard()));
  container.set(CORE_POLICY_GATE_TOKEN, gate);
  container.set(commentServiceToken, service);

  const dependencies = { container, cache: createMockCache() };
  setActiveApplicationContext({
    container,
    config: { get: () => undefined, set: () => undefined, has: () => false } as never,
    dependencies,
  });

  return new CommentController(dependencies, async (_key, callback) =>
    jsonResponse(await callback()),
  );
}

describe("CommentController", () => {
  test("lists comments and task comments through the cache wrapper", async () => {
    const paginate = mock(async () => ({
      data: [comment],
      meta: { page: 1, per_page: 10, total: 1, last_page: 1 },
    }));
    const paginateByTaskId = mock(async () => ({
      data: [comment],
      meta: { page: 1, per_page: 10, total: 1, last_page: 1 },
    }));

    const controller = bootstrapController({ paginate, paginateByTaskId });

    const indexResponse = await controller.index(new Request("http://example.test/comments"));
    expect(indexResponse.status).toBe(200);

    const byTaskResponse = await controller.byTask(
      Object.assign(new Request("http://example.test/tasks/20/comments"), {
        params: { id: "20" },
      }),
    );
    expect(byTaskResponse.status).toBe(200);
  });

  test("shows, updates, and deletes comments through secured handlers", async () => {
    const findByIdOrThrow = mock(async () => comment);
    const update = mock(async () => ({ ...comment, body: "Updated" }));
    const destroy = mock(async () => undefined);

    const controller = bootstrapController({ findByIdOrThrow, update, delete: destroy });
    const etag = etagFromResource(comment);

    const showResponse = await controller.show({
      params: { id: "30" },
      headers: new Headers({
        "x-authenticated-user-id": "1",
        "x-authenticated-user-role": "admin",
      }),
    } as never);
    expect(showResponse.status).toBe(200);

    const updateResponse = await controller.update({
      params: { id: "30" },
      headers: new Headers({
        "x-authenticated-user-id": "1",
        "x-authenticated-user-role": "admin",
        "content-type": "application/json",
        "if-match": etag,
      }),
      json: async () => ({ body: "Updated" }),
    } as never);
    expect(updateResponse.status).toBe(200);

    const deleteResponse = await controller.destroy({
      params: { id: "30" },
      headers: new Headers({
        "x-authenticated-user-id": "1",
        "x-authenticated-user-role": "admin",
        "if-match": etag,
      }),
    } as never);
    expect(deleteResponse.status).toBe(204);
  });

  test("creates comments for a task", async () => {
    const create = mock(async () => comment);
    const controller = bootstrapController({ create });

    const response = await controller.storeForTask(
      Object.assign(
        new Request("http://example.test/tasks/20/comments", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ body: "Looks good." }),
        }),
        { params: { id: "20" } },
      ),
    );

    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledWith({ task_id: 20, body: "Looks good." });
  });
});

afterAll(() => {
  mock.restore();
});
