import { describe, expect, test } from "bun:test";
import { ApiTokenGuard, AuthManager, CompositeGuard, GuestGuard } from "@getstrata/core/auth/guard";
import { UnauthorizedError } from "@getstrata/core/errors/http";
import { restoreEnvVar } from "../helpers/restoreEnv";

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

  test("GuestGuard ignores identity headers unless AUTH_DEV_HEADERS is exactly true", () => {
    const previous = process.env.AUTH_DEV_HEADERS;
    delete process.env.AUTH_DEV_HEADERS;
    try {
      expect(
        new GuestGuard().resolve(
          new Request("http://example.test", {
            headers: { "x-authenticated-user-id": "7" },
          }),
        ),
      ).toBeNull();
      process.env.AUTH_DEV_HEADERS = "TRUE";
      expect(
        new GuestGuard().resolve(
          new Request("http://example.test", {
            headers: { "x-authenticated-user-id": "7" },
          }),
        ),
      ).toBeNull();
    } finally {
      restoreEnvVar("AUTH_DEV_HEADERS", previous);
    }
  });

  test("GuestGuard treats missing verification header as unverified", () => {
    const previous = process.env.AUTH_DEV_HEADERS;
    process.env.AUTH_DEV_HEADERS = "true";
    try {
      const user = new GuestGuard().resolve(
        new Request("http://example.test", {
          headers: { "x-authenticated-user-id": "7" },
        }),
      );
      expect(user?.emailVerifiedAt).toBeNull();
      const verified = new GuestGuard().resolve(
        new Request("http://example.test", {
          headers: {
            "x-authenticated-user-id": "7",
            "x-authenticated-email-verified": "true",
          },
        }),
      );
      expect(verified?.emailVerifiedAt).toEqual(new Date(0));
    } finally {
      restoreEnvVar("AUTH_DEV_HEADERS", previous);
    }
  });

  test("failed bearer does not fall back to a session or guest guard", async () => {
    const sessionGuard = {
      resolve() {
        return { id: 99, role: "session" };
      },
    };
    const auth = new AuthManager(new CompositeGuard([sessionGuard]));
    auth.registerGuard("web", sessionGuard);
    auth.registerGuard("session", sessionGuard);

    expect(
      await auth.resolveWithSource(
        new Request("http://example.test", { headers: { authorization: "Bearer garbage" } }),
      ),
    ).toEqual({ user: null, credentialSource: null });
  });
});
