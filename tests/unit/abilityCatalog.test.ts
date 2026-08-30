import { describe, expect, test } from "bun:test";
import {
  ADMIN_ABILITIES,
  abilityCatalog,
  configureAbilityCatalog,
  MEMBER_ABILITIES,
  resolveAbilitiesForRole,
} from "../../src/core/auth/abilityCatalog";

describe("abilityCatalog", () => {
  test("resolves platform admin and member abilities", () => {
    expect(resolveAbilitiesForRole("admin")).toEqual(["*"]);
    expect(resolveAbilitiesForRole("member")).toEqual([...MEMBER_ABILITIES]);
    expect(MEMBER_ABILITIES).toContain("organizations:create");
    expect(abilityCatalog().admin).toEqual([...ADMIN_ABILITIES]);
  });

  test("apps can replace the catalog", () => {
    const previous = abilityCatalog();

    try {
      configureAbilityCatalog({
        member: ["notes:read"],
        admin: ["notes:write"],
        resolveForRole: (role) => (role === "admin" ? ["notes:write"] : ["notes:read"]),
      });

      expect(abilityCatalog().resolveForRole("admin")).toEqual(["notes:write"]);
    } finally {
      configureAbilityCatalog(previous);
    }
  });
});
