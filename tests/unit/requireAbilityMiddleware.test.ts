import { describe, expect, test } from "bun:test";
import type { AbilityChecker } from "@getstrata/core/auth/abilityChecker";
import type { AuthUser } from "@getstrata/core/auth/authContext";
import { runWithAuthUser } from "@getstrata/core/auth/authContext";
import { ForbiddenError } from "@getstrata/core/errors/http";
import { createRequireAbilityMiddleware } from "@getstrata/core/http/requireAbilityMiddleware";

function hasAbility(user: AuthUser | null, ability: string): boolean {
  const abilities = user?.abilities ?? [];
  return abilities.includes("*") || abilities.includes(ability);
}

const abilityChecker: AbilityChecker = {
  tokenCan: hasAbility,
  requireAbility(user, ability) {
    if (!hasAbility(user, ability)) {
      throw new ForbiddenError("Token ability required.");
    }
  },
};

describe("createRequireAbilityMiddleware", () => {
  test("allows users with the required ability", async () => {
    const middleware = createRequireAbilityMiddleware(abilityChecker)("applications:delete");

    const response = await runWithAuthUser(
      { id: 1, abilities: ["applications:delete"] },
      async () =>
        await middleware(new Request("http://example.test/applications/1"), async () =>
          Response.json({ ok: true }),
        ),
    );

    expect(response.status).toBe(200);
  });

  test("rejects users missing the required ability", async () => {
    const middleware = createRequireAbilityMiddleware(abilityChecker)("applications:delete");

    const response = await runWithAuthUser(
      { id: 1, abilities: ["applications:read"] },
      async () =>
        await middleware(new Request("http://example.test/applications/1"), async () =>
          Response.json({ ok: true }),
        ),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Token ability required." });
  });

  test("allows wildcard abilities", async () => {
    const middleware = createRequireAbilityMiddleware(abilityChecker)("departments:delete");

    const response = await runWithAuthUser(
      { id: 1, abilities: ["*"] },
      async () =>
        await middleware(new Request("http://example.test/departments/1"), async () =>
          Response.json({ ok: true }),
        ),
    );

    expect(response.status).toBe(200);
  });
});
