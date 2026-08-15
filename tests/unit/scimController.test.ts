import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { ServiceContainer } from "../../src/bootstrap/contracts";
import { etagFromResource } from "../../src/core/http/etag";
import ScimService from "../../src/modules/scim/service";
import { createMockCache } from "./testHelpers";

const now = new Date("2026-01-01T00:00:00.000Z");

const scimServiceMock = {
  serviceProviderConfig: mock(() => ({ patch: { supported: true } })),
  listUsers: mock(async () => ({ Resources: [], totalResults: 0 })),
  createUser: mock(async () => ({ id: "2", userName: "new@workhub.test" })),
  findUserRecord: mock(async (id: number) => ({ id, updated_at: now })),
  getUser: mock(async () => ({ id: "1", userName: "ada@workhub.test" })),
  patchUser: mock(async () => ({ id: "1", userName: "updated@workhub.test" })),
  deleteUser: mock(async () => undefined),
  listGroups: mock(async () => ({ Resources: [], totalResults: 0 })),
  getGroup: mock(async () => ({ id: "5", displayName: "Acme" })),
  findOrganizationRecord: mock(async () => ({ id: 5, updated_at: now })),
  patchGroup: mock(async () => ({ id: "5", displayName: "Acme Updated" })),
};

type ScimControllerClass = typeof import("../../src/modules/scim/controller").default;
let ScimControllerClass: ScimControllerClass;

beforeAll(async () => {
  mock.module("../../src/modules/scim/service", () => ({
    default: ScimService,
    createScimService: () => scimServiceMock,
  }));

  ({ default: ScimControllerClass } = await import("../../src/modules/scim/controller"));
});

afterAll(() => {
  mock.restore();
});

describe("ScimController", () => {
  function createController(): InstanceType<ScimControllerClass> {
    return new ScimControllerClass({
      container: new ServiceContainer(),
      cache: createMockCache(),
    });
  }

  test("returns service provider config", async () => {
    const controller = createController();
    const response = await controller.serviceProviderConfig();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ patch: { supported: true } });
  });

  test("lists and creates users", async () => {
    const controller = createController();

    const listResponse = await controller.listUsers(
      new Request("http://example.test/scim/v2/Users?startIndex=1&count=10"),
    );
    expect(listResponse.status).toBe(200);

    const createResponse = await controller.createUser(
      new Request("http://example.test/scim/v2/Users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userName: "new@workhub.test" }),
      }),
    );
    expect(createResponse.status).toBe(201);
  });

  test("shows, patches, and deletes users", async () => {
    const controller = createController();
    const record = { id: 1, updated_at: now };
    const etag = etagFromResource(record);

    const showResponse = await controller.showUser({
      params: { id: "1" },
      headers: new Headers(),
    } as never);
    expect(showResponse.status).toBe(200);

    const patchResponse = await controller.patchUser({
      params: { id: "1" },
      headers: new Headers({
        "content-type": "application/json",
        "if-match": etag,
      }),
      json: async () => ({
        Operations: [{ op: "replace", path: "userName", value: "updated@workhub.test" }],
      }),
    } as never);
    expect(patchResponse.status).toBe(200);

    const deleteResponse = await controller.deleteUser({
      params: { id: "1" },
      headers: new Headers({ "if-match": etag }),
    } as never);
    expect(deleteResponse.status).toBe(204);
  });

  test("lists and patches groups", async () => {
    const controller = createController();
    const record = { id: 5, updated_at: now };
    const etag = etagFromResource(record);

    const listResponse = await controller.listGroups(
      new Request("http://example.test/scim/v2/Groups?startIndex=1&count=10"),
    );
    expect(listResponse.status).toBe(200);

    const showResponse = await controller.showGroup({
      params: { id: "5" },
      headers: new Headers(),
    } as never);
    expect(showResponse.status).toBe(200);

    const patchResponse = await controller.patchGroup({
      params: { id: "5" },
      headers: new Headers({
        "content-type": "application/json",
        "if-match": etag,
      }),
      json: async () => ({
        Operations: [{ op: "replace", path: "displayName", value: "Acme Updated" }],
      }),
    } as never);
    expect(patchResponse.status).toBe(200);
  });
});
