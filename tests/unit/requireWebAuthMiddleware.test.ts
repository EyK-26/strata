import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { currentAuthUser } from "@getstrata/core/auth/authContext";
import { AuthManager, GuestGuard } from "@getstrata/core/auth/guard";
import { UnauthorizedError } from "@getstrata/core/errors/http";
import { composeMiddleware } from "@getstrata/core/http/middleware";
import { createRequireWebAuthMiddleware } from "@getstrata/core/http/requireWebAuthMiddleware";
import { enableDevAuthHeaders, restoreDevAuthHeaders } from "../helpers/devAuthHeaders";

describe("createRequireWebAuthMiddleware", () => {
  let previousHeaders: string | undefined;
  beforeEach(() => {
    previousHeaders = enableDevAuthHeaders();
  });
  afterEach(() => {
    restoreDevAuthHeaders(previousHeaders);
  });
  test("allows authenticated requests through", async () => {
    const auth = new AuthManager(new GuestGuard());
    const handler = composeMiddleware(createRequireWebAuthMiddleware(auth))(async () => {
      expect(currentAuthUser()?.id).toBe("1");
      return Response.json({ ok: true });
    });

    const response = await handler(
      new Request("http://example.test/projects/1", {
        headers: {
          "x-authenticated-user-id": "1",
          "x-authenticated-user-role": "member",
        },
      }),
    );

    expect(response.status).toBe(200);
  });

  test("rejects guests with UnauthorizedError for JSON requests", async () => {
    const auth = new AuthManager(new GuestGuard());
    const handler = composeMiddleware(createRequireWebAuthMiddleware(auth))(async () =>
      Response.json({ ok: true }),
    );

    await expect(
      handler(
        new Request("http://example.test/api/v1/projects/1", {
          headers: { accept: "application/json" },
        }),
      ),
    ).rejects.toThrow(UnauthorizedError);
  });

  test("redirects guests to login for HTML requests", async () => {
    const auth = new AuthManager(new GuestGuard());
    const handler = composeMiddleware(createRequireWebAuthMiddleware(auth))(async () =>
      Response.json({ ok: true }),
    );

    const response = await handler(
      new Request("http://example.test/forum?page=2", {
        headers: { accept: "text/html" },
      }),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/login?redirect=%2Fforum%3Fpage%3D2");
  });
});
