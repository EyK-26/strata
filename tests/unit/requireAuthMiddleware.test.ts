import { describe, expect, test } from "bun:test";
import { AuthManager, GuestGuard } from "../../src/core/auth/guard";
import { createRequireAuthMiddleware } from "../../src/core/http/requireAuthMiddleware";
import { composeMiddleware } from "../../src/core/http/middleware";

describe("createRequireAuthMiddleware", () => {
  test("allows authenticated requests through", async () => {
    const auth = new AuthManager(new GuestGuard());
    const handler = composeMiddleware(createRequireAuthMiddleware(auth))(
      async () => Response.json({ ok: true }),
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
    const handler = composeMiddleware(createRequireAuthMiddleware(auth))(
      async () => Response.json({ ok: true }),
    );

    const response = await handler(
      new Request("http://example.test/projects/1", {
        method: "DELETE",
      }),
    );

    expect(response.status).toBe(401);
  });
});
