import { describe, expect, test } from "bun:test";
import { resolveAbilitiesForRole } from "../../src/domain/abilities";

describe("abilities", () => {
  test("members receive scoped abilities", () => {
    const abilities = resolveAbilitiesForRole("member");

    expect(abilities).toContain("projects:create");
    expect(abilities).not.toContain("*");
  });

  test("platform admins receive wildcard abilities", () => {
    expect(resolveAbilitiesForRole("admin")).toEqual(["*"]);
  });
});
