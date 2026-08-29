import { describe, expect, test } from "bun:test";
import { ValidationError } from "@getstrata/core/errors/http";
import { parseWebUpdateOrganizationMemberRolePayload } from "../../src/modules/organization/webRequests";

describe("organization webRequests", () => {
  test("parseWebUpdateOrganizationMemberRolePayload accepts org roles", () => {
    expect(parseWebUpdateOrganizationMemberRolePayload({ role: "member" })).toEqual({
      role: "member",
    });
    expect(parseWebUpdateOrganizationMemberRolePayload({ role: "admin" })).toEqual({
      role: "admin",
    });
    expect(parseWebUpdateOrganizationMemberRolePayload({ role: "owner" })).toEqual({
      role: "owner",
    });
  });

  test("parseWebUpdateOrganizationMemberRolePayload rejects an invalid role", () => {
    expect(() => parseWebUpdateOrganizationMemberRolePayload({ role: "superadmin" })).toThrow(
      ValidationError,
    );

    try {
      parseWebUpdateOrganizationMemberRolePayload({ role: "superadmin" });
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).details).toEqual({
        role: ["Invalid organization role."],
      });
    }
  });
});
