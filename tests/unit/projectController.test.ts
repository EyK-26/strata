import { afterAll, describe, expect, mock, test } from "bun:test";
import { CORE_AUTH_TOKEN, CORE_POLICY_GATE_TOKEN } from "@getstrata/bootstrap/config";
import { ServiceContainer } from "@getstrata/bootstrap/contracts";
import { AuthManager, GuestGuard } from "@getstrata/core/auth/guard";
import { PolicyGate } from "@getstrata/core/auth/policy";
import { etagFromResource } from "@getstrata/core/http/etag";
import { jsonResponse } from "@getstrata/core/http/response";
import { setActiveApplicationContext } from "@getstrata/core/runtime/applicationRegistry";
import ProjectController from "../../src/modules/project/controller";
import ProjectPolicy from "../../src/modules/project/policy";
import { projectServiceToken } from "../../src/modules/project/provider";
import type { ProjectWithOrganizationRecord } from "../../src/modules/project/types";
import { createMockCache, createMockDependencies } from "./testHelpers";

const now = new Date("2026-01-01T00:00:00.000Z");

const project: ProjectWithOrganizationRecord = {
  id: 10,
  organization_id: 5,
  tenant_id: 1,
  name: "Platform",
  status: "active",
  created_at: now,
  updated_at: now,
  deleted_at: null,
  organization: {
    id: 5,
    name: "Acme Labs",
    slug: "acme-labs",
  },
};

function bootstrapController(service: Record<string, unknown>): ProjectController {
  const container = new ServiceContainer();
  const gate = new PolicyGate();
  gate.register("project", new ProjectPolicy());
  container.set(CORE_AUTH_TOKEN, new AuthManager(new GuestGuard()));
  container.set(CORE_POLICY_GATE_TOKEN, gate);
  container.set(projectServiceToken, service);

  const dependencies = createMockDependencies(container, createMockCache());
  setActiveApplicationContext({
    container,
    config: { get: () => undefined, set: () => undefined, has: () => false } as never,
    dependencies,
  });

  return new ProjectController(dependencies, async (_key, callback) =>
    jsonResponse(await callback()),
  );
}

describe("ProjectController", () => {
  test("lists projects through the cache wrapper", async () => {
    const paginate = mock(async () => ({
      data: [project],
      meta: { page: 1, per_page: 10, total: 1, last_page: 1 },
    }));

    const controller = bootstrapController({ paginate });
    const response = await controller.index(new Request("http://example.test/projects?page=1"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: [{ id: 10, name: "Platform" }],
    });
  });

  test("shows, updates, and deletes projects through secured handlers", async () => {
    const findByIdOrThrow = mock(async () => project);
    const update = mock(async () => ({ ...project, name: "Updated" }));
    const destroy = mock(async () => undefined);

    const controller = bootstrapController({ findByIdOrThrow, update, delete: destroy });
    const etag = etagFromResource(project);

    const showResponse = await controller.show({
      params: { id: "10" },
      url: "http://example.test/projects/10",
      headers: new Headers({
        "x-authenticated-user-id": "1",
        "x-authenticated-user-role": "admin",
      }),
    } as never);
    expect(showResponse.status).toBe(200);

    const updateResponse = await controller.update({
      params: { id: "10" },
      url: "http://example.test/projects/10",
      headers: new Headers({
        "x-authenticated-user-id": "1",
        "x-authenticated-user-role": "admin",
        "content-type": "application/json",
        "if-match": etag,
      }),
      json: async () => ({ name: "Updated" }),
    } as never);
    expect(updateResponse.status).toBe(200);

    const deleteResponse = await controller.destroy({
      params: { id: "10" },
      url: "http://example.test/projects/10",
      headers: new Headers({
        "x-authenticated-user-id": "1",
        "x-authenticated-user-role": "admin",
        "if-match": etag,
      }),
    } as never);
    expect(deleteResponse.status).toBe(204);
  });

  test("creates projects from request bodies", async () => {
    const create = mock(async () => project);
    const controller = bootstrapController({ create });

    const response = await controller.store(
      new Request("http://example.test/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organization_id: 5,
          name: "Platform",
          status: "active",
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
