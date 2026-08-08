import { describe, expect, test } from "bun:test";
import { AuthManager, ApiTokenGuard, GuestGuard } from "../../src/core/auth/guard";
import { createAuthMiddleware } from "../../src/core/http/authMiddleware";
import { composeMiddleware } from "../../src/core/http/middleware";

describe("GuestGuard", () => {
  test("resolves users from development auth headers", async () => {
    const auth = new AuthManager(new GuestGuard());
    const user = await auth.resolve(
      new Request("http://example.test/organizations", {
        headers: {
          "x-authenticated-user-id": "7",
          "x-authenticated-user-role": "member",
        },
      }),
    );

    expect(user).toEqual({ id: "7", role: "member", abilities: ["*"] });
  });
});

describe("createAuthMiddleware", () => {
  test("sets x-authenticated-user-id for valid bearer tokens", async () => {
    const auth = new AuthManager(
      new ApiTokenGuard({
        token: "secret-token",
        user: { id: 42, role: "admin" },
      }),
    );
    const handler = composeMiddleware(createAuthMiddleware(auth))(async () => {
      return Response.json({ ok: true });
    });

    const response = await handler(
      new Request("http://example.test/organizations", {
        headers: { authorization: "Bearer secret-token" },
      }),
    );

    expect(response.headers.get("x-authenticated-user-id")).toBe("42");
  });
});
