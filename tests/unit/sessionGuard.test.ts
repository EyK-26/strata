import { describe, expect, test } from "bun:test";
import { resolveAbilitiesForRole } from "@getstrata/core/auth/abilityCatalog";
import {
  createSessionCookie,
  createSessionReader,
  sessionCookieName,
  sessionCookieOptionsFromEnvironment,
  sessionTtlSeconds,
} from "@getstrata/core/auth/sessionCookie";
import { SessionGuard } from "@getstrata/core/auth/sessionGuard";
import {
  AuthAccountNotFoundError,
  type AuthSessionValidity,
  type AuthUserDirectory,
} from "@getstrata/core/contracts/authUserDirectory";
import { requireConfiguredSecret } from "@getstrata/core/runtime/appKeyPrefix";

function requestWithSession(userId = 1): Request {
  const cookie =
    createSessionCookie(userId, {}, sessionCookieOptionsFromEnvironment(process.env)).split(
      ";",
    )[0] ?? "";

  return new Request("http://example.test/account", {
    headers: { cookie },
  });
}

function directoryWith(directory: Partial<AuthUserDirectory> | null): AuthUserDirectory {
  return {
    resolveUserFromToken: async () => null,
    findByIdOrThrow: async () => {
      throw new AuthAccountNotFoundError();
    },
    ...directory,
  };
}
function sessionPorts(validity: AuthSessionValidity | null = null) {
  return {
    read: createSessionReader({
      cookieName: sessionCookieName(process.env),
      ttlSeconds: sessionTtlSeconds(process.env),
      secret: requireConfiguredSecret(["SESSION_SECRET"], "session-secret"),
    }),
    abilities: resolveAbilitiesForRole,
    hasCredential: (request: Request) => request.headers.has("cookie"),
    validity,
  };
}

describe("SessionGuard", () => {
  test("returns null without a session cookie or user directory", async () => {
    const guard = new SessionGuard(
      directoryWith({ findByIdOrThrow: async () => ({ id: 1, role: "member" }) }),
      sessionPorts(),
    );

    expect(await guard.resolve(new Request("http://example.test/"))).toBeNull();
    expect(
      await new SessionGuard(directoryWith(null), sessionPorts()).resolve(requestWithSession()),
    ).toBeNull();
  });

  test("returns null when the user is missing or the session was invalidated", async () => {
    const missing = new SessionGuard(
      directoryWith({
        findByIdOrThrow: async () => {
          throw new AuthAccountNotFoundError();
        },
      }),
      sessionPorts(),
    );
    expect(await missing.resolve(requestWithSession())).toBeNull();

    const invalidated = new SessionGuard(
      directoryWith({
        findByIdOrThrow: async () => ({
          id: 1,
          role: "admin",
          session_valid_after: new Date(Date.now() + 60_000),
        }),
      }),
      sessionPorts(),
    );
    expect(await invalidated.resolve(requestWithSession())).toBeNull();
  });

  test("resolves the user with explicit account-only or active registry validation", async () => {
    const withoutHook = new SessionGuard(
      directoryWith({
        findByIdOrThrow: async () => ({
          id: 1,
          role: "admin",
          email_verified_at: new Date("2026-01-01T00:00:00.000Z"),
        }),
      }),
      sessionPorts(),
    );
    const user = await withoutHook.resolve(requestWithSession());
    expect(user).toMatchObject({ id: 1, role: "admin" });
    expect(user?.abilities?.length).toBeGreaterThan(0);

    const active = new SessionGuard(
      directoryWith({
        findByIdOrThrow: async () => ({ id: 1, role: "member" }),
      }),
      sessionPorts({ hasActiveBrowserSession: async () => true }),
    );
    expect(await active.resolve(requestWithSession())).toMatchObject({ id: 1, role: "member" });
  });

  test("returns null when hasActiveBrowserSession is false", async () => {
    const guard = new SessionGuard(
      directoryWith({
        findByIdOrThrow: async () => ({ id: 1, role: "admin" }),
      }),
      sessionPorts({ hasActiveBrowserSession: async () => false }),
    );

    expect(await guard.resolve(requestWithSession())).toBeNull();
  });
});
