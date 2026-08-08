import { describe, expect, test } from "bun:test";
import { ApiTokenGuard, AuthManager, GuestGuard } from "../../src/core/auth/guard";
import { UnauthorizedError } from "../../src/core/errors/http";

describe("AuthManager", () => {
  test("GuestGuard always resolves null without dev headers", async () => {
    const auth = new AuthManager(new GuestGuard());

    expect(await auth.check()).toBe(false);
    expect(await auth.user()).toBeNull();
  });

  test("ApiTokenGuard authenticates matching bearer tokens", async () => {
    const auth = new AuthManager(
      new ApiTokenGuard({
        token: "secret-token",
        user: { id: 1, role: "admin" },
      }),
    );
    const request = new Request("http://example.test", {
      headers: { authorization: "Bearer secret-token" },
    });

    expect(await auth.resolve(request)).toEqual({ id: 1, role: "admin" });
    expect(await auth.check(request)).toBe(true);
  });

  test("ApiTokenGuard rejects missing or invalid tokens", async () => {
    const auth = new AuthManager(new ApiTokenGuard({ token: "secret-token", user: { id: 1 } }));

    expect(await auth.check(new Request("http://example.test"))).toBe(false);
    expect(
      await auth.check(
        new Request("http://example.test", {
          headers: { authorization: "Bearer wrong" },
        }),
      ),
    ).toBe(false);
  });

  test("requireUser throws UnauthorizedError for guests", async () => {
    const auth = new AuthManager(new GuestGuard());

    await expect(auth.requireUser()).rejects.toThrow(UnauthorizedError);
  });
});
