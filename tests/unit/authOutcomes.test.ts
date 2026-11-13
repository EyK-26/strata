import { expect, test } from "bun:test";
import {
  ApiTokenGuard,
  AuthManager,
  type AuthOutcome,
  absentAuth,
  authenticatedAuth,
  CompositeGuard,
  DatabaseTokenGuard,
  GuestGuard,
  invalidAuth,
} from "@getstrata/core/auth/guard";
import { signJwt } from "@getstrata/core/auth/jwt";
import { JwtGuard } from "@getstrata/core/auth/jwtGuard";
import { SessionGuard } from "@getstrata/core/auth/sessionGuard";
import { AuthAccountNotFoundError } from "@getstrata/core/contracts/authUserDirectory";
import { createMfaSecretCodec } from "@getstrata/core/crypto/mfaSecret";
import { ForbiddenError } from "@getstrata/core/errors/http";
import { createAuthMiddleware } from "@getstrata/core/http/authMiddleware";
import { withJsonErrorHandling } from "@getstrata/core/http/response";
import { guestGuardOptions } from "../helpers/devAuthHeaders";

const request = (authorization?: string) =>
  new Request("http://example.test/", {
    headers: authorization === undefined ? {} : { authorization },
  });

test("guards distinguish absent, invalid and authenticated proof with provenance", async () => {
  const token = new ApiTokenGuard({ token: "valid", user: { id: "actor" } });
  expect(token.authenticate(request())).toEqual(absentAuth);
  expect(token.authenticate(request("Bearer"))).toEqual(invalidAuth("bearer"));
  expect(token.authenticate(request("Bearer invalid"))).toEqual(invalidAuth("bearer"));
  expect(token.authenticate(request("Bearer valid"))).toEqual(
    authenticatedAuth({ id: "actor" }, "bearer"),
  );
  const auth = new AuthManager(
    new GuestGuard(guestGuardOptions({ APP_ENV: "local", AUTH_DEV_HEADERS: "true" })),
  );
  const invalid = request("Unknown proof");
  invalid.headers.set("x-authenticated-user-id", "guest-admin");
  expect(await auth.authenticate(invalid)).toEqual(invalidAuth(null));
  for (const header of ["", "   "]) {
    const empty = request(header);
    empty.headers.set("x-authenticated-user-id", "guest-admin");
    expect(await auth.authenticate(empty)).toEqual(invalidAuth(null));
  }
});

test("composite stops on invalid/error outcomes and never consults a weaker guard", async () => {
  for (const outcome of [
    invalidAuth("session"),
    { status: "error", user: null, credentialSource: "session", error: undefined } as const,
  ]) {
    let later = 0;
    const composite = new CompositeGuard([
      { authenticate: () => outcome },
      {
        authenticate: () => {
          later++;
          return authenticatedAuth({ id: "weaker" }, "guest");
        },
      },
    ]);
    expect(await composite.authenticate(request())).toEqual(outcome);
    expect(later).toBe(0);
  }
});

test("bearer dispatch skips the wrong bearer format but preserves invalid supplied provenance", async () => {
  const secret = "outcome-fixture-signing-key-at-least-32-characters";
  const tokens = new DatabaseTokenGuard({ resolveUserFromToken: async () => null });
  const jwt = new JwtGuard({
    secret,
    directory: { findByIdOrThrow: async (id) => ({ id, role: "member" }) },
  });
  const auth = new AuthManager(new CompositeGuard([tokens, jwt]));
  auth.registerGuard("api", tokens).registerGuard("jwt", jwt);
  expect(
    (await auth.authenticate(request(`Bearer ${signJwt({ sub: 1 }, { secret })}`))).status,
  ).toBe("authenticated");
  expect(await auth.authenticate(request("Bearer invalid"))).toEqual(invalidAuth("bearer"));
});

test("missing accounts deny while operational failures retain exact unknown errors", async () => {
  const proof = new Request("http://example.test/", { headers: { cookie: "session=proof" } });
  const session = {
    hasCredential: () => true,
    read: () => ({ userId: 1, role: "member", issuedAt: Date.now() }),
    abilities: () => [],
    validity: null,
  };
  for (const error of [
    new AuthAccountNotFoundError(),
    new Error("directory failed"),
    undefined,
    null,
    false,
    0,
    "",
  ]) {
    const guard = new SessionGuard(
      {
        findByIdOrThrow: async () => {
          throw error;
        },
      },
      session,
    );
    const outcome = await guard.authenticate(proof);
    if (error instanceof AuthAccountNotFoundError) expect(outcome).toEqual(invalidAuth("session"));
    else {
      expect(outcome.status).toBe("error");
      if (outcome.status !== "error") throw new Error("Expected error outcome");
      expect(Object.hasOwn(outcome, "error")).toBe(true);
      expect(outcome.error).toBe(error);
    }
  }
});

test("HTTP maps invalid proofs to 401 and every unknown error to 500 without running work", async () => {
  for (const outcome of [
    invalidAuth("bearer"),
    ...[
      undefined,
      null,
      false,
      0,
      "",
      new ForbiddenError("private credential store detail"),
      { status: 418, message: "private credential store detail" },
    ].map(
      (error): AuthOutcome => ({ status: "error", user: null, credentialSource: "bearer", error }),
    ),
  ]) {
    const manager = new AuthManager({ authenticate: () => outcome });
    let handled = false;
    const middleware = createAuthMiddleware(manager);
    const response = await withJsonErrorHandling((request: Request) =>
      middleware(request, async () => {
        handled = true;
        return new Response("ok");
      }),
    )(request());
    expect(response.status).toBe(outcome.status === "invalid" ? 401 : 500);
    expect(handled).toBe(false);
    if (outcome.status === "error")
      expect(await response.json()).toEqual({ error: "Internal server error." });
  }
});

test("malformed custom outcomes cannot establish identity or advance a composite", async () => {
  for (const malformed of [
    { status: "absent", user: { id: "injected" }, credentialSource: null },
    { status: "authenticated", user: null, credentialSource: "bearer" },
    { status: "authenticated", user: { role: "admin" }, credentialSource: "bearer" },
    { status: "authenticated", user: { id: 1 }, credentialSource: "unknown" },
    { status: "unknown", user: { id: 1 }, credentialSource: "session" },
    { status: "error", user: null, credentialSource: "session" },
  ]) {
    let later = 0;
    const manager = new AuthManager(
      new CompositeGuard([
        { authenticate: () => malformed as AuthOutcome },
        {
          authenticate: () => {
            later++;
            return authenticatedAuth({ id: 1 }, "guest");
          },
        },
      ]),
    );
    const result = await manager.authenticate(request());
    expect(result.status).toBe("error");
    expect(later).toBe(0);
    await expect(manager.resolve(request())).rejects.toBeInstanceOf(TypeError);
  }
});

test("malformed supplied browser cookies cannot downgrade to a development principal", async () => {
  const { CookieSessionGuard, CookieSessionStore } = await import(
    "@getstrata/bootstrap/web/session"
  );
  const store = new CookieSessionStore({} as never, {} as never, "fixture-cookie-signing-secret", {
    production: false,
    rls: false,
  });
  const session = new CookieSessionGuard(store);
  const guest = new GuestGuard(guestGuardOptions({ APP_ENV: "local", AUTH_DEV_HEADERS: "true" }));
  const auth = new AuthManager(new CompositeGuard([session, guest]));
  for (const cookie of [
    "strata_session=%ZZ",
    "strata_session=",
    "strata_session=invalid",
    "strata_session",
  ]) {
    const proof = new Request("http://example.test/", {
      headers: { cookie, "x-authenticated-user-id": "weaker" },
    });
    expect(await auth.authenticate(proof)).toEqual(invalidAuth("session"));
  }
  const unrelated = new Request("http://example.test/", {
    headers: { cookie: "theme=dark", "x-authenticated-user-id": "weaker" },
  });
  expect((await auth.authenticate(unrelated)).status).toBe("authenticated");
});

test("session and recovery adapters must return exact true before authentication grants", async () => {
  const accounts = { findByIdOrThrow: async () => ({ id: 1, role: "member" }) };
  const session = new SessionGuard(accounts, {
    hasCredential: () => true,
    read: () => ({ userId: 1, role: "member", issuedAt: Date.now() }),
    abilities: () => [],
    validity: { hasActiveBrowserSession: async () => "false" as never },
  });
  expect(await session.authenticate(request())).toEqual(invalidAuth("session"));
  const { BasicAuthGuard } = await import("@getstrata/core/auth/basicAuthGuard");
  const { hashRecoveryCode } = await import("@getstrata/core/security/recoveryCodes");
  const code = "1111-2222-3333-4444-5555-6666-7777-8888";
  const basic = new BasicAuthGuard({
    mfaSecrets: createMfaSecretCodec(process.env),
    accounts: {
      findByIdOrThrow: async () => ({
        id: 1,
        role: "member",
        mfa_enabled: true,
        mfa_secret: "unused",
        mfa_recovery_codes: JSON.stringify([hashRecoveryCode(code)]),
      }),
    },
    credentials: { verifyCredentials: async () => ({ id: 1 }) },
    persistRecovery: async () => "true" as never,
  });
  const proof = request(`Basic ${btoa("user:password")}`);
  proof.headers.set("x-mfa-code", code);
  expect(await basic.authenticate(proof)).toEqual(invalidAuth("basic"));
});

test("JWT uses a complete safe numeric subject and the matching fresh account identity", async () => {
  const secret = "strict-subject-fixture-secret-at-least-32-characters";
  let lookups = 0;
  const guard = new JwtGuard({
    secret,
    directory: {
      findByIdOrThrow: async (id) => {
        lookups++;
        return { id, role: "member" };
      },
    },
  });
  for (const sub of [
    "1junk",
    "1.5",
    " 1",
    "0x1",
    "1e0",
    "01",
    "",
    0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    expect(await guard.authenticate(request(`Bearer ${signJwt({ sub }, { secret })}`))).toEqual(
      invalidAuth("bearer"),
    );
  }
  expect(lookups).toBe(0);
  const valid = await guard.authenticate(request(`Bearer ${signJwt({ sub: "1" }, { secret })}`));
  expect(valid.status).toBe("authenticated");
  expect(valid.user?.id).toBe(1);
  const mismatched = new JwtGuard({
    secret,
    directory: { findByIdOrThrow: async () => ({ id: 2, role: "admin" }) },
  });
  expect(
    await mismatched.authenticate(request(`Bearer ${signJwt({ sub: 1 }, { secret })}`)),
  ).toEqual(invalidAuth("bearer"));
});

test("session account lookup must return the exact identity carried by the proof", async () => {
  let validityChecks = 0;
  const guard = new SessionGuard(
    { findByIdOrThrow: async () => ({ id: 2, role: "admin" }) },
    {
      hasCredential: () => true,
      read: () => ({ userId: 1, role: "member", issuedAt: Date.now() }),
      abilities: () => [],
      validity: {
        hasActiveBrowserSession: async () => {
          validityChecks++;
          return true;
        },
      },
    },
  );
  expect(await guard.authenticate(request())).toEqual(invalidAuth("session"));
  expect(validityChecks).toBe(0);
});

test("JWT guard rejects an explicitly empty bearer without consulting account storage", async () => {
  let lookups = 0;
  const guard = new JwtGuard({
    secret: "explicit-jwt-empty-bearer-fixture-secret",
    directory: {
      findByIdOrThrow: async (id) => {
        lookups++;
        return { id, role: "member" };
      },
    },
  });
  expect(await guard.authenticate(request("Bearer"))).toEqual(invalidAuth("bearer"));
  expect(lookups).toBe(0);
});
