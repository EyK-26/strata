import { describe, expect, test } from "bun:test";
import { isGlobalAdmin, hasMinimumOrgRole as rankOrgRole } from "../../src/core/auth/accessControl";
import { hasMinimumOrgRole, membershipContext } from "../../src/core/auth/membershipContext";

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
});
