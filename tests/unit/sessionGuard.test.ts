import { describe, expect, test } from "bun:test";
import { createSessionCookie } from "@getstrata/core/auth/sessionCookie";
import { SessionGuard } from "@getstrata/core/auth/sessionGuard";
import { CORE_AUTH_USER_DIRECTORY_TOKEN } from "@getstrata/core/contracts/serviceTokens";

function requestWithSession(userId = 1): Request {
  const cookie = createSessionCookie(userId).split(";")[0] ?? "";

  return new Request("http://example.test/account", {
    headers: { cookie },
  });
}

function containerWith(directory: unknown) {
  return {
    has(key: string) {
      return key === CORE_AUTH_USER_DIRECTORY_TOKEN && directory !== null;
    },
    resolve() {
      return directory;
    },
  };
}

describe("SessionGuard", () => {
  test("returns null without a session cookie or user directory", async () => {
    const guard = new SessionGuard(containerWith({ findByIdOrThrow: async () => ({ id: 1 }) }));

    expect(await guard.resolve(new Request("http://example.test/"))).toBeNull();
    expect(await new SessionGuard(containerWith(null)).resolve(requestWithSession())).toBeNull();
  });

  test("returns null when the user is missing or the session was invalidated", async () => {
    const missing = new SessionGuard(
      containerWith({
        findByIdOrThrow: async () => {
          throw new Error("missing");
        },
      }),
    );
    expect(await missing.resolve(requestWithSession())).toBeNull();

    const invalidated = new SessionGuard(
      containerWith({
        findByIdOrThrow: async () => ({
          id: 1,
          role: "admin",
          session_valid_after: new Date(Date.now() + 60_000),
        }),
      }),
    );
    expect(await invalidated.resolve(requestWithSession())).toBeNull();
  });

  test("resolves the user when hasActiveBrowserSession is absent or true", async () => {
    const withoutHook = new SessionGuard(
      containerWith({
        findByIdOrThrow: async () => ({
          id: 1,
          role: "admin",
          email_verified_at: new Date("2026-01-01T00:00:00.000Z"),
        }),
      }),
    );
    const user = await withoutHook.resolve(requestWithSession());
    expect(user).toMatchObject({ id: 1, role: "admin" });
    expect(user?.abilities?.length).toBeGreaterThan(0);

    const active = new SessionGuard(
      containerWith({
        findByIdOrThrow: async () => ({ id: 1, role: "member" }),
        hasActiveBrowserSession: async () => true,
      }),
    );
    expect(await active.resolve(requestWithSession())).toMatchObject({ id: 1, role: "member" });
  });

  test("returns null when hasActiveBrowserSession is false", async () => {
    const guard = new SessionGuard(
      containerWith({
        findByIdOrThrow: async () => ({ id: 1, role: "admin" }),
        hasActiveBrowserSession: async () => false,
      }),
    );

    expect(await guard.resolve(requestWithSession())).toBeNull();
  });
});
