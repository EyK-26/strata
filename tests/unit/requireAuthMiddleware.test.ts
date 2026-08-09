import { describe, expect, test } from "bun:test";
import { AuthManager, GuestGuard } from "@getstrata/core/auth/guard";
import { composeMiddleware } from "@getstrata/core/http/middleware";
import { createRequireAuthMiddleware } from "@getstrata/core/http/requireAuthMiddleware";

describe("createRequireAuthMiddleware", () => {
  test("allows authenticated requests through", async () => {
    const auth = new AuthManager(new GuestGuard());
    const handler = composeMiddleware(createRequireAuthMiddleware(auth))(async () =>
      Response.json({ ok: true }),
    );

    const response = await handler(
      new Request("http://example.test/projects/1", {
        method: "DELETE",
        headers: {
          "x-authenticated-user-id": "1",
          "x-authenticated-user-role": "member",
        },
      }),
    );

    expect(response.status).toBe(200);
  });

  test("rejects guests with UnauthorizedError", async () => {
    const auth = new AuthManager(new GuestGuard());
    const handler = composeMiddleware(createRequireAuthMiddleware(auth))(async () =>
      Response.json({ ok: true }),
    );

    const response = await handler(
      new Request("http://example.test/projects/1", {
        method: "DELETE",
      }),
    );

    expect(response.status).toBe(401);
  });
});
