import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { AuthManager, GuestGuard } from "@getstrata/core/auth/guard";
import { composeMiddleware } from "@getstrata/core/http/middleware";
import { createRequireAuthMiddleware } from "@getstrata/core/http/requireAuthMiddleware";
import {
  enableDevAuthHeaders,
  guestGuardOptions,
  restoreDevAuthHeaders,
} from "../helpers/devAuthHeaders";

describe("createRequireAuthMiddleware", () => {
  let previousHeaders: string | undefined;
  beforeEach(() => {
    previousHeaders = enableDevAuthHeaders();
  });
  afterEach(() => {
    restoreDevAuthHeaders(previousHeaders);
  });
  test("allows authenticated requests through", async () => {
    const auth = new AuthManager(new GuestGuard(guestGuardOptions()));
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
    const auth = new AuthManager(new GuestGuard(guestGuardOptions()));
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

test("required-auth middleware accepts a check-only adapter and preserves operational failures", async () => {
  const request = new Request("http://example.test");
  let calls = 0;
  const middleware = createRequireAuthMiddleware({
    check: async (received) => {
      expect(received).toBe(request);
      return ++calls === 1;
    },
  });
  let handled = 0;
  const next = async () => {
    handled++;
    return new Response("ok");
  };
  expect((await middleware(request, next)).status).toBe(200);
  expect((await middleware(request, next)).status).toBe(401);
  expect(handled).toBe(1);
  const error = new Error("authentication store unavailable");
  const failing = createRequireAuthMiddleware({
    check: async () => {
      throw error;
    },
  });
  await expect(failing(request, next)).rejects.toBe(error);
  expect(handled).toBe(1);
});
