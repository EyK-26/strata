import { describe, expect, test } from "bun:test";
import {
  hasMinimumOrgRole,
  isGlobalAdmin,
  ROLE_RANK,
  requireAuthenticatedUser,
  resolveUserId,
} from "../../src/core/auth/accessControl";
import { runWithAuthUser } from "../../src/core/auth/authContext";
import { ForbiddenError } from "../../src/core/errors/http";

describe("accessControl", () => {
  test("isGlobalAdmin detects admin role", () => {
    expect(isGlobalAdmin(null)).toBe(false);
    expect(isGlobalAdmin({ id: 1, role: "member" })).toBe(false);
    expect(isGlobalAdmin({ id: 1, role: "admin" })).toBe(true);
  });

  test("hasMinimumOrgRole compares organization role ranks", () => {
    expect(hasMinimumOrgRole(null, "member")).toBe(false);
    expect(hasMinimumOrgRole(undefined, "member")).toBe(false);
    expect(hasMinimumOrgRole("member", "admin")).toBe(false);
    expect(hasMinimumOrgRole("admin", "member")).toBe(true);
    expect(hasMinimumOrgRole("owner", "admin")).toBe(true);
    expect(ROLE_RANK.owner).toBeGreaterThan(ROLE_RANK.admin);
  });

  test("requireAuthenticatedUser throws when no user is in context", () => {
    expect(() => requireAuthenticatedUser()).toThrow(ForbiddenError);
    expect(() => requireAuthenticatedUser()).toThrow("Authentication required.");

    runWithAuthUser({ id: 1, role: "member" }, () => {
      expect(requireAuthenticatedUser()).toEqual({ id: 1, role: "member" });
    });
  });

  test("resolveUserId validates numeric user ids", () => {
    expect(resolveUserId({ id: 42, role: "member" })).toBe(42);
    expect(resolveUserId({ id: "7", role: "member" })).toBe(7);

    expect(() => resolveUserId({ id: 0, role: "member" })).toThrow("Invalid authenticated user.");
    expect(() => resolveUserId({ id: "bad", role: "member" })).toThrow(
      "Invalid authenticated user.",
    );
  });
});
