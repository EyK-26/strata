import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { ConfigStore, ServiceContainer } from "@getstrata/bootstrap/contracts";
import { runWithAuthUser } from "@getstrata/core/auth/authContext";
import MembershipService from "@getstrata/core/auth/membershipService";
import {
  resolveApplicationDependencies,
  setActiveApplicationContext,
} from "@getstrata/core/runtime/applicationRegistry";
import { createMockCache, createMockDependencies } from "./testHelpers";

const membershipService = {
  requireOrgAccess: mock(async () => "admin" as const),
  listMembersForOrganization: mock(async (organizationId: number) => [
    {
      id: 1,
      organization_id: organizationId,
      user_id: 1,
      role: "owner" as const,
      created_at: new Date("2026-01-01T00:00:00.000Z"),
    },
    {
      id: 2,
      organization_id: organizationId,
      user_id: 2,
      role: "admin" as const,
      created_at: new Date("2026-01-01T00:00:00.000Z"),
    },
    {
      id: 3,
      organization_id: organizationId,
      user_id: 3,
      role: "member" as const,
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
  listOrganizationIdsForUser: mock(async () => [] as number[]),
  removeMember: mock(async () => undefined),
  updateMemberRole: mock(
    async (organizationId: number, userId: number, role: "owner" | "admin" | "member") => ({
      id: 1,
      organization_id: organizationId,
      user_id: userId,
      role,
      created_at: new Date("2026-01-01T00:00:00.000Z"),
    }),
  ),
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

afterAll(() => {
  try {
    resolveApplicationDependencies().container.set("core.membership", new MembershipService());
  } catch {
    // No active app context to restore.
  }
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
          user_id: 1,
          role: "owner",
          created_at: "2026-01-01T00:00:00.000Z",
        },
        {
          id: 2,
          organization_id: 5,
          user_id: 2,
          role: "admin",
          created_at: "2026-01-01T00:00:00.000Z",
        },
        {
          id: 3,
          organization_id: 5,
          user_id: 3,
          role: "member",
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

    const response = await runWithAuthUser({ id: 1, role: "admin" }, () =>
      controller.destroy(
        Object.assign(new Request("http://example.test/organizations/5/members/3"), {
          params: { id: "5", userId: "3" },
        }),
      ),
    );

    expect(response.status).toBe(204);
    expect(membershipService.removeMember).toHaveBeenCalledWith(5, 3);
  });

  test("destroy lets a member leave and rejects the last owner", async () => {
    const controller = new OrganizationMemberControllerClass({
      container: {},
      cache: {},
    } as never);

    const left = await runWithAuthUser({ id: 3, role: "member" }, () =>
      controller.destroy(
        Object.assign(new Request("http://example.test/organizations/5/members/3"), {
          params: { id: "5", userId: "3" },
        }),
      ),
    );
    expect(left.status).toBe(204);

    const lastOwner = await runWithAuthUser({ id: 1, role: "member" }, () =>
      controller.destroy(
        Object.assign(new Request("http://example.test/organizations/5/members/1"), {
          params: { id: "5", userId: "1" },
        }),
      ),
    );
    expect(lastOwner.status).toBe(403);
    expect(await lastOwner.json()).toEqual({ error: "Cannot leave as the last owner." });
  });

  test("update changes a member role", async () => {
    const controller = new OrganizationMemberControllerClass({
      container: {},
      cache: {},
    } as never);

    const response = await controller.update(
      Object.assign(
        new Request("http://example.test/organizations/5/members/3", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ role: "owner" }),
        }),
        { params: { id: "5", userId: "3" } },
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: 1,
      organization_id: 5,
      user_id: 3,
      role: "owner",
      created_at: "2026-01-01T00:00:00.000Z",
    });
    expect(membershipService.requireOrgAccess).toHaveBeenCalledWith(5, "admin");
    expect(membershipService.updateMemberRole).toHaveBeenCalledWith(5, 3, "owner");
  });

  test("update requires valid organization and user ids", async () => {
    const controller = new OrganizationMemberControllerClass({
      container: {},
      cache: {},
    } as never);

    const response = await controller.update(
      Object.assign(
        new Request("http://example.test/organizations/5/members/abc", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ role: "member" }),
        }),
        { params: { id: "5", userId: "abc" } },
      ),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Organization id and user id are required.",
    });
  });

  test("update rejects an invalid role", async () => {
    const controller = new OrganizationMemberControllerClass({
      container: {},
      cache: {},
    } as never);

    const response = await controller.update(
      Object.assign(
        new Request("http://example.test/organizations/5/members/3", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ role: "superadmin" }),
        }),
        { params: { id: "5", userId: "3" } },
      ),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "role must be owner, admin, or member.",
    });
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

  test("listInvitations returns pending invitations", async () => {
    const listPending = mock(async () => [
      {
        id: 3,
        organization_id: 5,
        email: "invitee@workhub.test",
        role: "member" as const,
        invited_by: 1,
        expires_at: "2026-02-01T00:00:00.000Z",
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ]);
    const controller = new OrganizationMemberControllerClass(
      { container: {}, cache: {} } as never,
      {
        listPending,
      } as never,
    );

    const response = await controller.listInvitations(
      Object.assign(new Request("http://example.test/organizations/5/invitations"), {
        params: { id: "5" },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: [
        {
          id: 3,
          organization_id: 5,
          email: "invitee@workhub.test",
          role: "member",
          invited_by: 1,
          expires_at: "2026-02-01T00:00:00.000Z",
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    expect(membershipService.requireOrgAccess).toHaveBeenCalledWith(5, "member");
  });

  test("listInvitations requires a valid organization id", async () => {
    const controller = new OrganizationMemberControllerClass(
      { container: {}, cache: {} } as never,
      {
        listPending: mock(async () => []),
      } as never,
    );

    const response = await controller.listInvitations(
      Object.assign(new Request("http://example.test/organizations/abc/invitations"), {
        params: { id: "abc" },
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Organization id is required." });
  });

  test("storeInvitation creates an invitation for the current admin", async () => {
    const { runWithAuthUser } = await import("@getstrata/core/auth/authContext");
    const invite = mock(async () => ({
      invitation: {
        id: 9,
        organization_id: 5,
        email: "new@workhub.test",
        role: "admin",
        invited_by: 1,
        expires_at: "2026-02-01T00:00:00.000Z",
        created_at: "2026-01-01T00:00:00.000Z",
      },
      token: "plain",
      acceptUrl: "/invitations/accept",
    }));
    const controller = new OrganizationMemberControllerClass(
      { container: {}, cache: {} } as never,
      {
        invite,
      } as never,
    );

    const response = await runWithAuthUser({ id: 1, role: "admin" }, () =>
      controller.storeInvitation(
        Object.assign(
          new Request("http://example.test/organizations/5/invitations", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ email: "new@workhub.test", role: "admin" }),
          }),
          { params: { id: "5" } },
        ),
      ),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      id: 9,
      organization_id: 5,
      email: "new@workhub.test",
      role: "admin",
      invited_by: 1,
      expires_at: "2026-02-01T00:00:00.000Z",
      created_at: "2026-01-01T00:00:00.000Z",
    });
    expect(invite).toHaveBeenCalledWith({
      organizationId: 5,
      email: "new@workhub.test",
      role: "admin",
      invitedByUserId: 1,
    });
  });

  test("storeInvitation requires an authenticated admin and a valid organization id", async () => {
    const controller = new OrganizationMemberControllerClass(
      { container: {}, cache: {} } as never,
      {
        invite: mock(async () => ({})),
      } as never,
    );

    const missingOrg = await controller.storeInvitation(
      Object.assign(
        new Request("http://example.test/organizations/0/invitations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: "new@workhub.test" }),
        }),
        { params: { id: "0" } },
      ),
    );
    expect(missingOrg.status).toBe(400);

    const unauthenticated = await controller.storeInvitation(
      Object.assign(
        new Request("http://example.test/organizations/5/invitations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: "new@workhub.test" }),
        }),
        { params: { id: "5" } },
      ),
    );
    expect(unauthenticated.status).toBe(403);
  });

  test("destroyInvitation cancels a pending invitation", async () => {
    const cancel = mock(async () => undefined);
    const controller = new OrganizationMemberControllerClass(
      { container: {}, cache: {} } as never,
      {
        cancel,
      } as never,
    );

    const response = await controller.destroyInvitation(
      Object.assign(new Request("http://example.test/organizations/5/invitations/3"), {
        params: { id: "5", invitationId: "3" },
      }),
    );

    expect(response.status).toBe(204);
    expect(cancel).toHaveBeenCalledWith(5, 3);
  });

  test("destroyInvitation requires valid ids", async () => {
    const controller = new OrganizationMemberControllerClass(
      { container: {}, cache: {} } as never,
      {
        cancel: mock(async () => undefined),
      } as never,
    );

    const response = await controller.destroyInvitation(
      Object.assign(new Request("http://example.test/organizations/5/invitations/abc"), {
        params: { id: "5", invitationId: "abc" },
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Organization id and invitation id are required.",
    });
  });

  test("acceptInvitation joins the current user", async () => {
    const { runWithAuthUser } = await import("@getstrata/core/auth/authContext");
    const accept = mock(async () => ({
      id: 11,
      organization_id: 5,
      user_id: 1,
      role: "member" as const,
      created_at: new Date("2026-01-01T00:00:00.000Z"),
    }));
    const controller = new OrganizationMemberControllerClass(
      { container: {}, cache: {} } as never,
      { accept } as never,
      { findById: mock(async () => ({ id: 1, email: "admin@workhub.test" })) } as never,
    );

    const response = await runWithAuthUser({ id: 1, role: "admin" }, () =>
      controller.acceptInvitation(
        new Request("http://example.test/invitations/accept", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: "plain-token" }),
        }),
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: 11,
      organization_id: 5,
      user_id: 1,
      role: "member",
      created_at: "2026-01-01T00:00:00.000Z",
    });
    expect(accept).toHaveBeenCalledWith("admin@workhub.test", "plain-token", {
      id: 1,
      email: "admin@workhub.test",
    });
  });

  test("acceptInvitation requires a token and an authenticated user", async () => {
    const controller = new OrganizationMemberControllerClass(
      { container: {}, cache: {} } as never,
      { accept: mock(async () => ({})) } as never,
      { findById: mock(async () => null) } as never,
    );

    const unauthenticated = await controller.acceptInvitation(
      new Request("http://example.test/invitations/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "plain-token" }),
      }),
    );
    expect(unauthenticated.status).toBe(403);

    const { runWithAuthUser } = await import("@getstrata/core/auth/authContext");
    const missingUser = await runWithAuthUser({ id: 1, role: "admin" }, () =>
      controller.acceptInvitation(
        new Request("http://example.test/invitations/accept", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: "plain-token" }),
        }),
      ),
    );
    expect(missingUser.status).toBe(403);

    const missingTokenController = new OrganizationMemberControllerClass(
      { container: {}, cache: {} } as never,
      { accept: mock(async () => ({})) } as never,
      { findById: mock(async () => ({ id: 1, email: "admin@workhub.test" })) } as never,
    );
    const missingToken = await runWithAuthUser({ id: 1, role: "admin" }, () =>
      missingTokenController.acceptInvitation(
        new Request("http://example.test/invitations/accept", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        }),
      ),
    );
    expect(missingToken.status).toBe(400);
  });
});
