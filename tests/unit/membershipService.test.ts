import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { setActiveApplicationContext } from "../../src/bootstrap/applicationRegistry";
import { ConfigStore, ServiceContainer } from "../../src/bootstrap/contracts";
import { runWithAuthUser } from "../../src/core/auth/authContext";
import { ForbiddenError } from "../../src/core/errors/http";
import { createMockCache, createMockDependencies } from "./testHelpers";

const membershipRepository = {
  listForUser: mock(async (userId: number) =>
    userId === 2
      ? [
          { id: 1, organization_id: 5, user_id: 2, role: "admin" as const, created_at: new Date() },
          {
            id: 2,
            organization_id: 6,
            user_id: 2,
            role: "member" as const,
            created_at: new Date(),
          },
        ]
      : [],
  ),
  findMembership: mock(async (userId: number, organizationId: number) => {
    if (userId === 2 && organizationId === 5) {
      return {
        id: 1,
        organization_id: 5,
        user_id: 2,
        role: "admin" as const,
        created_at: new Date("2026-01-01T00:00:00.000Z"),
      };
    }

    return null;
  }),
  listForOrganization: mock(async (organizationId: number) =>
    organizationId === 5
      ? [
          {
            id: 1,
            organization_id: 5,
            user_id: 2,
            role: "admin" as const,
            created_at: new Date("2026-01-01T00:00:00.000Z"),
          },
        ]
      : [],
  ),
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
  removeMember: mock(async () => true),
};

type MembershipServiceModule = typeof import("../../src/core/auth/membershipService");

let MembershipService: MembershipServiceModule["default"];
let resolveMembershipService: MembershipServiceModule["resolveMembershipService"];

beforeAll(async () => {
  const actual = await import("../../src/core/auth/membershipContext");
  mock.module("../../src/core/auth/membershipContext", () => ({
    ...actual,
    membershipRepository,
  }));

  ({ default: MembershipService, resolveMembershipService } = await import(
    "../../src/core/auth/membershipService"
  ));
});

afterAll(() => {
  mock.restore();
});

describe("MembershipService", () => {
  test("listOrganizationIdsForUser maps memberships to organization ids", async () => {
    const service = new MembershipService();

    await expect(service.listOrganizationIdsForUser(2)).resolves.toEqual([5, 6]);
    await expect(service.listOrganizationIdsForUser(999)).resolves.toEqual([]);
  });

  test("getOrgRole returns membership roles or null", async () => {
    const service = new MembershipService();

    await expect(service.getOrgRole(2, 5)).resolves.toBe("admin");
    await expect(service.getOrgRole(2, 99)).resolves.toBeNull();
  });

  test("requireOrgAccess requires authentication", async () => {
    const service = new MembershipService();

    await expect(service.requireOrgAccess(5, "member", null)).rejects.toThrow(ForbiddenError);
  });

  test("requireOrgAccess grants global admins owner access", async () => {
    const service = new MembershipService();

    await expect(service.requireOrgAccess(5, "owner", { id: 1, role: "admin" })).resolves.toBe(
      "owner",
    );
  });

  test("requireOrgAccess validates minimum organization roles", async () => {
    const service = new MembershipService();

    await expect(service.requireOrgAccess(5, "member", { id: 2, role: "member" })).resolves.toBe(
      "admin",
    );

    await expect(service.requireOrgAccess(5, "owner", { id: 2, role: "member" })).rejects.toThrow(
      "Organization membership required.",
    );

    await expect(
      service.requireOrgAccess(5, "member", { id: "bad", role: "member" }),
    ).rejects.toThrow("Invalid authenticated user.");
  });

  test("filterAccessibleOrganizationIds handles guests, admins, and members", async () => {
    const service = new MembershipService();

    await expect(service.filterAccessibleOrganizationIds([5, 6, 7], null)).resolves.toEqual([]);
    await expect(
      service.filterAccessibleOrganizationIds([5, 6, 7], { id: 1, role: "admin" }),
    ).resolves.toEqual([5, 6, 7]);
    await expect(
      service.filterAccessibleOrganizationIds([5, 6, 7], { id: 2, role: "member" }),
    ).resolves.toEqual([5, 6]);
  });

  test("delegates member management to the repository", async () => {
    const service = new MembershipService();

    await expect(service.addOwnerOnOrganizationCreate(5, 2)).resolves.toBeUndefined();
    expect(membershipRepository.addMember).toHaveBeenCalledWith({
      organizationId: 5,
      userId: 2,
      role: "owner",
    });

    await expect(service.listMembersForOrganization(5)).resolves.toHaveLength(1);
    await expect(service.addMember({ organizationId: 5, userId: 3 })).resolves.toMatchObject({
      user_id: 3,
    });
    await expect(service.removeMember(5, 3)).resolves.toBe(true);
  });

  test("resolveMembershipService returns container service when registered", () => {
    const container = new ServiceContainer();
    const registered = new MembershipService();
    container.set("core.membership", registered);

    setActiveApplicationContext({
      container,
      config: new ConfigStore(),
      dependencies: createMockDependencies(container, createMockCache()),
    });

    expect(resolveMembershipService()).toBe(registered);
  });

  test("resolveMembershipService falls back to a new service instance", () => {
    const container = new ServiceContainer();

    setActiveApplicationContext({
      container,
      config: new ConfigStore(),
      dependencies: createMockDependencies(container, createMockCache()),
    });

    expect(resolveMembershipService()).toBeInstanceOf(MembershipService);
  });
});

describe("MembershipService current auth user defaults", () => {
  test("requireOrgAccess uses currentAuthUser when user is omitted", async () => {
    const service = new MembershipService();

    await runWithAuthUser({ id: 2, role: "member" }, async () => {
      await expect(service.requireOrgAccess(5)).resolves.toBe("admin");
      await expect(service.requireOrgAccess(5, "member")).resolves.toBe("admin");
    });
  });

  test("filterAccessibleOrganizationIds uses currentAuthUser when user is omitted", async () => {
    const service = new MembershipService();

    await runWithAuthUser({ id: 2, role: "member" }, async () => {
      await expect(service.filterAccessibleOrganizationIds([5, 7])).resolves.toEqual([5]);
    });
  });
});
