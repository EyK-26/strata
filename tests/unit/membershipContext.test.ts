import { describe, expect, test } from "bun:test";
import {
  isGlobalAdmin,
  hasMinimumOrgRole as rankOrgRole,
} from "@getstrata/core/auth/accessControl";
import {
  configureMembershipLookup,
  hasMinimumOrgRole,
  membershipContext,
  resetMembershipLookupForTests,
  resolveMembershipLookup,
} from "@getstrata/core/auth/membershipContext";
import OrganizationMemberRepository from "../../src/modules/organization/memberRepository";

describe("membershipContext", () => {
  test("isGlobalAdmin recognizes platform admins", () => {
    expect(isGlobalAdmin({ id: 1, role: "admin", abilities: ["*"] })).toBe(true);
    expect(isGlobalAdmin({ id: 2, role: "member", abilities: ["*"] })).toBe(false);
  });

  test("hasMinimumOrgRole uses request-scoped membership map", () => {
    membershipContext.run(
      {
        organizationIds: [1],
        rolesByOrganizationId: new Map([[1, "admin"]]),
      },
      () => {
        expect(hasMinimumOrgRole(1, "member")).toBe(true);
        expect(hasMinimumOrgRole(1, "admin")).toBe(true);
        expect(hasMinimumOrgRole(1, "owner")).toBe(false);
        expect(hasMinimumOrgRole(2, "member")).toBe(false);
      },
    );
  });

  test("accessControl ranks org roles consistently", () => {
    expect(rankOrgRole("owner", "admin")).toBe(true);
    expect(rankOrgRole("member", "admin")).toBe(false);
  });

  test("unconfigured membership lookup is read-only until WorkHub registers an adapter", async () => {
    resetMembershipLookupForTests();

    try {
      const lookup = resolveMembershipLookup();

      await expect(lookup.listForUser(1)).resolves.toEqual([]);
      await expect(lookup.findMembership(1, 1)).resolves.toBeNull();
      await expect(lookup.listForOrganization(1)).resolves.toEqual([]);
      await expect(lookup.addMember({ organizationId: 1, userId: 1 })).rejects.toThrow(
        /configureMembershipLookup/,
      );
      await expect(lookup.removeMember(1, 1)).rejects.toThrow(/configureMembershipLookup/);
    } finally {
      configureMembershipLookup(new OrganizationMemberRepository());
    }
  });
});
