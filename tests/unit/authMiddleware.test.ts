import { describe, expect, test } from "bun:test";
import { ApiTokenGuard, AuthManager, GuestGuard } from "@getstrata/core/auth/guard";
import { composeMiddleware } from "@getstrata/core/http/middleware";
import { createAuthMiddleware } from "../../src/core/http/authMiddleware";

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

    expect(user).toEqual({
      id: "7",
      role: "member",
      abilities: [
        "organizations:read",
        "projects:read",
        "projects:create",
        "tasks:read",
        "tasks:create",
        "comments:read",
        "comments:create",
        "attachments:read",
        "attachments:create",
        "auth:tokens:read",
        "auth:tokens:write",
      ],
    });
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
