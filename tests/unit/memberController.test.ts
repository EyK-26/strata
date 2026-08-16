import { beforeAll, describe, expect, mock, test } from "bun:test";
import { ConfigStore, ServiceContainer } from "../../src/bootstrap/contracts";
import { setActiveApplicationContext } from "../../src/core/runtime/applicationRegistry";
import { createMockCache, createMockDependencies } from "./testHelpers";

const membershipService = {
  requireOrgAccess: mock(async () => "admin" as const),
  listMembersForOrganization: mock(async () => [
    {
      id: 1,
      organization_id: 5,
      user_id: 2,
      role: "admin" as const,
      created_at: new Date("2026-01-01T00:00:00.000Z"),
    },
  ]),
  addMember: mock(
    async (input: {
      organizationId: number;
      userId: number;
      role?: "owner" | "admin" | "member";
    }) => ({
      id: 9,
      organization_id: input.organizationId,
      user_id: input.userId,
      role: input.role ?? "member",
      created_at: new Date("2026-01-01T00:00:00.000Z"),
    }),
  ),
  removeMember: mock(async () => undefined),
};

type OrganizationMemberController =
  typeof import("../../src/modules/organization/memberController").default;

let OrganizationMemberControllerClass: OrganizationMemberController;

beforeAll(async () => {
  const container = new ServiceContainer();
  container.set("core.membership", membershipService);

  setActiveApplicationContext({
    container,
    config: new ConfigStore(),
    dependencies: createMockDependencies(container, createMockCache()),
  });

  ({ default: OrganizationMemberControllerClass } = await import(
    "../../src/modules/organization/memberController"
  ));
});

describe("OrganizationMemberController", () => {
  test("index lists members for an organization", async () => {
    const controller = new OrganizationMemberControllerClass({
      container: {},
      cache: {},
    } as never);

    const response = await controller.index(
      Object.assign(new Request("http://example.test/organizations/5/members"), {
        params: { id: "5" },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: [
        {
          id: 1,
          organization_id: 5,
          user_id: 2,
          role: "admin",
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    expect(membershipService.requireOrgAccess).toHaveBeenCalledWith(5, "member");
  });

  test("index requires a valid organization id", async () => {
    const controller = new OrganizationMemberControllerClass({
      container: {},
      cache: {},
    } as never);

    const response = await controller.index(
      Object.assign(new Request("http://example.test/organizations/abc/members"), {
        params: { id: "abc" },
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Organization id is required." });
  });

  test("store adds members with default and explicit roles", async () => {
    const controller = new OrganizationMemberControllerClass({
      container: {},
      cache: {},
    } as never);

    const response = await controller.store(
      Object.assign(
        new Request("http://example.test/organizations/5/members", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ user_id: 3, role: "admin" }),
        }),
        { params: { id: "5" } },
      ),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      id: 9,
      organization_id: 5,
      user_id: 3,
      role: "admin",
      created_at: "2026-01-01T00:00:00.000Z",
    });
    expect(membershipService.requireOrgAccess).toHaveBeenCalledWith(5, "admin");
  });

  test("store validates organization and user ids", async () => {
    const controller = new OrganizationMemberControllerClass({
      container: {},
      cache: {},
    } as never);

    const invalidOrgResponse = await controller.store(
      Object.assign(
        new Request("http://example.test/organizations/0/members", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ user_id: 3 }),
        }),
        { params: { id: "0" } },
      ),
    );

    expect(invalidOrgResponse.status).toBe(400);
    expect(await invalidOrgResponse.json()).toEqual({ error: "Organization id is required." });

    const missingUserResponse = await controller.store(
      Object.assign(
        new Request("http://example.test/organizations/5/members", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        }),
        { params: { id: "5" } },
      ),
    );

    expect(missingUserResponse.status).toBe(400);
    expect(await missingUserResponse.json()).toEqual({ error: "user_id is required." });
  });

  test("destroy removes members from an organization", async () => {
    const controller = new OrganizationMemberControllerClass({
      container: {},
      cache: {},
    } as never);

    const response = await controller.destroy(
      Object.assign(new Request("http://example.test/organizations/5/members/3"), {
        params: { id: "5", userId: "3" },
      }),
    );

    expect(response.status).toBe(204);
    expect(membershipService.removeMember).toHaveBeenCalledWith(5, 3);
  });

  test("destroy requires valid organization and user ids", async () => {
    const controller = new OrganizationMemberControllerClass({
      container: {},
      cache: {},
    } as never);

    const response = await controller.destroy(
      Object.assign(new Request("http://example.test/organizations/5/members/abc"), {
        params: { id: "5", userId: "abc" },
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Organization id and user id are required.",
    });
  });
});
