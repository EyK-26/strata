import { afterEach, describe, expect, test } from "bun:test";
import { runWithAuthUser } from "@getstrata/core/auth/authContext";
import {
  configureMembershipLookup,
  currentOrganizationIds,
  currentOrgRole,
  hasMinimumOrgRole,
  hasOrgMembership,
  resetMembershipLookupForTests,
  resolveMembershipLookup,
  runWithMembershipContext,
} from "@getstrata/core/auth/membershipContext";

afterEach(() => {
  resetMembershipLookupForTests();
});

describe("membershipContext", () => {
  test("unconfigured lookup refuses mutations", async () => {
    const lookup = resolveMembershipLookup();
    await expect(
      lookup.addMember({ organizationId: 1, userId: 2, role: "member" }),
    ).rejects.toThrow(/configureMembershipLookup/);
    await expect(lookup.removeMember(1, 2)).rejects.toThrow(/configureMembershipLookup/);
    await expect(lookup.updateMemberRole(1, 2, "admin")).rejects.toThrow(
      /configureMembershipLookup/,
    );
    await expect(lookup.listForUser(1)).resolves.toEqual([]);
    await expect(lookup.findMembership(1, 2)).resolves.toBeNull();
    await expect(lookup.listForOrganization(1)).resolves.toEqual([]);
  });

  test("loads memberships for members and skips lookup for admins", async () => {
    configureMembershipLookup({
      listForUser: async () => [
        { id: 1, organization_id: 5, user_id: 2, role: "admin", created_at: new Date() },
        { id: 2, organization_id: 6, user_id: 2, role: "member", created_at: new Date() },
      ],
      findMembership: async () => null,
      listForOrganization: async () => [],
      addMember: async () => {
        throw new Error("unused");
      },
      removeMember: async () => undefined,
      updateMemberRole: async () => {
        throw new Error("unused");
      },
    });

    await runWithAuthUser({ id: 2, role: "member" }, async () => {
      await runWithMembershipContext(() => {
        expect(currentOrganizationIds()).toEqual([5, 6]);
        expect(currentOrgRole(5)).toBe("admin");
        expect(hasOrgMembership(6)).toBe(true);
        expect(hasOrgMembership(9)).toBe(false);
        expect(hasMinimumOrgRole(5, "admin")).toBe(true);
        expect(hasMinimumOrgRole(6, "admin")).toBe(false);
        expect(hasMinimumOrgRole(9, "member")).toBe(false);
      });
    });

    await runWithAuthUser({ id: 1, role: "admin" }, async () => {
      await runWithMembershipContext(() => {
        expect(currentOrganizationIds()).toEqual([]);
      });
    });
  });
});
