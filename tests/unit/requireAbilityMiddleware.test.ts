import { describe, expect, test } from "bun:test";
import { runWithAuthUser } from "../../src/core/auth/authContext";
import { createRequireAbilityMiddleware } from "../../src/core/http/requireAbilityMiddleware";
import TokenService from "../../src/modules/user/tokenService";

describe("createRequireAbilityMiddleware", () => {
  test("allows users with the required ability", async () => {
    const tokenService = new TokenService({} as never, {} as never);
    const middleware = createRequireAbilityMiddleware(tokenService)("projects:delete");

    const response = await runWithAuthUser(
      { id: 1, abilities: ["projects:delete"] },
      async () =>
        await middleware(new Request("http://example.test/projects/1"), async () =>
          Response.json({ ok: true }),
        ),
    );

    expect(response.status).toBe(200);
  });

  test("rejects users missing the required ability", async () => {
    const tokenService = new TokenService({} as never, {} as never);
    const middleware = createRequireAbilityMiddleware(tokenService)("projects:delete");

    const response = await runWithAuthUser(
      { id: 1, abilities: ["projects:read"] },
      async () =>
        await middleware(new Request("http://example.test/projects/1"), async () =>
          Response.json({ ok: true }),
        ),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Token ability required." });
  });

  test("allows wildcard abilities", async () => {
    const tokenService = new TokenService({} as never, {} as never);
    const middleware = createRequireAbilityMiddleware(tokenService)("organizations:delete");

    const response = await runWithAuthUser(
      { id: 1, abilities: ["*"] },
      async () =>
        await middleware(new Request("http://example.test/organizations/1"), async () =>
          Response.json({ ok: true }),
        ),
    );

    expect(response.status).toBe(200);
  });
});
