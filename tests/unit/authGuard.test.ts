import { describe, expect, test } from "bun:test";
import { UnauthorizedError } from "../../src/core/errors/http";
import {
  ApiTokenGuard,
  AuthManager,
  GuestGuard,
} from "../../src/core/auth/guard";

describe("AuthManager", () => {
  test("GuestGuard always resolves null", () => {
    const auth = new AuthManager(new GuestGuard());

    expect(auth.check()).toBe(false);
    expect(auth.user()).toBeNull();
  });

  test("ApiTokenGuard authenticates matching bearer tokens", () => {
    const auth = new AuthManager(
      new ApiTokenGuard({
        token: "secret-token",
        user: { id: 1, role: "admin" },
      }),
    );
    const request = new Request("http://example.test", {
      headers: { authorization: "Bearer secret-token" },
    });

    expect(auth.resolve(request)).toEqual({ id: 1, role: "admin" });
    expect(auth.check(request)).toBe(true);
  });

  test("ApiTokenGuard rejects missing or invalid tokens", () => {
    const auth = new AuthManager(
      new ApiTokenGuard({ token: "secret-token", user: { id: 1 } }),
    );

    expect(auth.check(new Request("http://example.test"))).toBe(false);
    expect(
      auth.check(
        new Request("http://example.test", {
          headers: { authorization: "Bearer wrong" },
        }),
      ),
    ).toBe(false);
  });

  test("requireUser throws UnauthorizedError for guests", () => {
    const auth = new AuthManager(new GuestGuard());

    expect(() => auth.requireUser()).toThrow(UnauthorizedError);
  });
});
