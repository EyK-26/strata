import { describe, expect, test } from "bun:test";
import {
  ADMIN_ABILITIES,
  MEMBER_ABILITIES,
  resolveAbilitiesForRole,
} from "../../src/core/auth/abilityCatalog";

describe("abilityCatalog", () => {
  test("resolves platform admin and member abilities", () => {
    expect(resolveAbilitiesForRole("admin")).toEqual(["*"]);
    expect(resolveAbilitiesForRole("member")).toEqual([...MEMBER_ABILITIES]);
    expect(MEMBER_ABILITIES).toContain("profile:read");
    expect(MEMBER_ABILITIES).toContain("auth:tokens:delete");
    expect(ADMIN_ABILITIES).toContain("webhooks:write");
    expect(Object.isFrozen(MEMBER_ABILITIES)).toBe(true);
    expect(Object.isFrozen(ADMIN_ABILITIES)).toBe(true);
  });
});
