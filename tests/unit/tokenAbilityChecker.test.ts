import { describe, expect, test } from "bun:test";
import { createTokenAbilityChecker } from "@getstrata/core/auth/tokenAbilityChecker";
import { ForbiddenError } from "@getstrata/core/errors/http";

describe("token ability checker", () => {
  const checker = createTokenAbilityChecker();

  test("allows wildcard and exact abilities", () => {
    expect(checker.tokenCan(null, "audit:export")).toBe(false);
    expect(checker.tokenCan({ id: 1 }, "audit:export")).toBe(false);
    expect(checker.tokenCan({ id: 1, abilities: ["audit:export"] }, "audit:export")).toBe(true);
    expect(checker.tokenCan({ id: 1, abilities: ["*"] }, "audit:export")).toBe(true);
    expect(checker.tokenCan({ id: 1, abilities: ["other"] }, "audit:export")).toBe(false);
  });

  test("requireAbility throws when the ability is missing", () => {
    expect(() => checker.requireAbility({ id: 1, abilities: ["other"] }, "audit:export")).toThrow(
      ForbiddenError,
    );
    expect(() => checker.requireAbility({ id: 1, abilities: ["*"] }, "audit:export")).not.toThrow();
  });
});
