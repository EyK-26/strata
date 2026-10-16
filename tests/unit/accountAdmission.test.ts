import { afterEach, expect, test } from "bun:test";
import {
  CookieSessionAuthManager,
  CookieSessionGuard,
  CookieSessionStore,
  type SessionUser,
} from "@getstrata/bootstrap/web/session";
import {
  isAccountActive,
  isAuthUserActive,
  matchesAuthVersion,
} from "@getstrata/core/auth/accountState";
import { BasicAuthGuard } from "@getstrata/core/auth/basicAuthGuard";
import { ApiTokenGuard, AuthManager, DatabaseTokenGuard } from "@getstrata/core/auth/guard";
import { type JwtPayload, signJwt } from "@getstrata/core/auth/jwt";
import { JwtGuard } from "@getstrata/core/auth/jwtGuard";
import { hashPassword } from "@getstrata/core/auth/password";
import { completePasswordLogin } from "@getstrata/core/auth/passwordLogin";
import { createSessionCookie, readSession } from "@getstrata/core/auth/sessionCookie";
import { SessionGuard } from "@getstrata/core/auth/sessionGuard";
import type {
  AuthUserDirectory,
  AuthUserRecord,
} from "@getstrata/core/contracts/authUserDirectory";
import { CORE_AUTH_USER_DIRECTORY_TOKEN } from "@getstrata/core/contracts/serviceTokens";

const secret = "account-admission-fixture-secret-at-least-32-characters";
const original = { ...process.env };
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
  Object.assign(process.env, original);
});
function container(directory: AuthUserDirectory) {
  return {
    has(key: string) {
      return key === CORE_AUTH_USER_DIRECTORY_TOKEN;
    },
    resolve<T>() {
      return directory as T;
    },
  };
}
function cookieRequest(header: string) {
  return new Request("http://localhost/account", {
    headers: { cookie: header.split(";")[0] ?? "" },
  });
}
function bearer(token: string) {
  return new Request("http://localhost/account", { headers: { authorization: `Bearer ${token}` } });
}
function directoryFor(record: AuthUserRecord): AuthUserDirectory {
  return {
    async findByIdOrThrow() {
      return record;
    },
    async findByEmail() {
      return record;
    },
    async resolveUserFromToken() {
      return { id: record.id, role: record.role, isActive: record.is_active };
    },
  };
}

test("JWT account status and version reject disabled and stale proofs even at an equal timestamp", async () => {
  const now = Date.now,
    instant = now();
  Date.now = () => instant;
  try {
    const record = {
      id: 1,
      role: "member",
      is_active: false,
      auth_version: 0,
      session_valid_after: new Date(instant),
    };
    const guard = new JwtGuard({ secret, directory: directoryFor(record) });
    const old = signJwt({ sub: 1, authVersion: 0 }, { secret });
    expect(await guard.resolve(bearer(old))).toBeNull();
    record.is_active = true;
    record.auth_version = 1;
    expect(await guard.resolve(bearer(old))).toBeNull();
    const fresh = signJwt({ sub: 1, authVersion: 1 }, { secret });
    expect(await guard.resolve(bearer(fresh))).toMatchObject({ id: 1 });
    for (const value of [undefined, -1, 0, 1.5, "1", null, Number.MAX_SAFE_INTEGER + 1]) {
      const malformed: JwtPayload = { sub: 1 };
      Object.assign(malformed, { authVersion: value }); // Signed malformed fixture, not a production issuance path.
      expect(await guard.resolve(bearer(signJwt(malformed, { secret })))).toBeNull();
    }
    const legacy = new JwtGuard({ secret, directory: directoryFor({ id: 1, role: "member" }) });
    expect(await legacy.resolve(bearer(signJwt({ sub: 1 }, { secret })))).toMatchObject({ id: 1 });
  } finally {
    Date.now = now;
  }
});

test("versioned signed sessions reject stale or missing versions while legacy sessions remain readable", async () => {
  process.env.SESSION_SECRET = secret;
  const record = { id: 1, role: "member", is_active: true, auth_version: 0 };
  const guard = new SessionGuard(container(directoryFor(record)));
  const old = createSessionCookie(1, { authVersion: 0 });
  expect(readSession(cookieRequest(old))).toMatchObject({ userId: 1, authVersion: 0 });
  expect(await guard.resolve(cookieRequest(old))).toMatchObject({ id: 1 });
  record.is_active = false;
  expect(await guard.resolve(cookieRequest(old))).toBeNull();
  record.is_active = true;
  record.auth_version = 1;
  expect(await guard.resolve(cookieRequest(old))).toBeNull();
  expect(await guard.resolve(cookieRequest(createSessionCookie(1)))).toBeNull();
  for (const remember of [false, true]) {
    const fresh = createSessionCookie(1, { authVersion: 1, remember });
    expect(await guard.resolve(cookieRequest(fresh))).toMatchObject({ id: 1 });
    const encoded = fresh.split(";")[0] ?? "";
    const damaged = encoded.replace(/.$/, (x) => (x === "0" ? "1" : "0"));
    expect(
      readSession(new Request("http://localhost", { headers: { cookie: damaged } })),
    ).toBeNull();
  }
  for (const authVersion of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])
    expect(() => createSessionCookie(1, { authVersion })).toThrow();
  const legacy = new SessionGuard(container(directoryFor({ id: 1, role: "member" })));
  expect(await legacy.resolve(cookieRequest(createSessionCookie(1)))).toMatchObject({ id: 1 });
  expect(
    await legacy.resolve(cookieRequest(createSessionCookie(1, { remember: true }))),
  ).toMatchObject({ id: 1 });
});

test("disabled password and Basic paths deny before accepting MFA or consuming recovery", async () => {
  const record = {
    id: 1,
    role: "member",
    password: await hashPassword("Fixture!Password123"),
    is_active: false,
    mfa_enabled: true,
    mfa_secret: null,
    mfa_recovery_codes: "[]",
  };
  expect(completePasswordLogin(record)).toEqual({ ok: false, error: "account_inactive" });
  const request = new Request("http://localhost/account", {
    headers: { authorization: `Basic ${btoa("fixture@example.test:Fixture!Password123")}` },
  });
  expect(await new BasicAuthGuard(container(directoryFor(record))).resolve(request)).toBeNull();
  // Exercise verifyCredentials fallback as well as the stored-password path.
  const fallback = directoryFor({ ...record, password: null });
  delete fallback.findByEmail;
  let fallbackCalls = 0;
  fallback.verifyCredentials = async () => {
    fallbackCalls++;
    return { id: 1, role: "member" };
  };
  expect(await new BasicAuthGuard(container(fallback)).resolve(request)).toBeNull();
  expect(fallbackCalls).toBe(1);
  expect(completePasswordLogin({ is_active: false, mfa_enabled: false })).toEqual({
    ok: false,
    error: "account_inactive",
  });
  expect(completePasswordLogin({ mfa_enabled: false })).toEqual({ ok: true });
});

test("opaque and static guards reject explicitly inactive principals and AuthManager enforces custom guard results", async () => {
  const record = { id: 1, role: "member", is_active: false };
  const opaque = new DatabaseTokenGuard(container(directoryFor(record)));
  expect(await opaque.resolve(bearer("opaque-fixture"))).toBeNull();
  expect(
    new ApiTokenGuard({ token: "static-fixture", user: { id: 1, isActive: false } }).resolve(
      bearer("static-fixture"),
    ),
  ).toBeNull();
  const manager = new AuthManager({ resolve: () => ({ id: 1, isActive: false }) });
  expect(await manager.user(new Request("http://localhost"))).toBeNull();
  manager.registerGuard("api", { resolve: () => ({ id: 1, isActive: false }) });
  expect(await manager.user(bearer("opaque-fixture"))).toBeNull();
  record.is_active = true;
  expect(await opaque.resolve(bearer("opaque-fixture"))).toMatchObject({ id: 1 });
});

test("database-cookie stores reject disabled default/custom loaders and refuse explicitly disabled session creation", async () => {
  process.env.TENANCY_DRIVER = "none";
  let active: unknown = false,
    writes = 0;
  const sql = {
    async unsafe<T>(query: string): Promise<T[]> {
      if (query.includes("FROM sessions"))
        return [
          { user_id: 1, expires_at: new Date(Date.now() + 60000), session_created_at: new Date() },
        ] as T[];
      if (query.includes("FROM users"))
        return [
          { id: 1, name: "Fixture", email: "fixture@example.test", is_active: active },
        ] as T[];
      writes++;
      return [];
    },
  };
  const user: SessionUser = { id: 1, name: "Fixture", email: "fixture@example.test" };
  const store = new CookieSessionStore(sql, secret),
    request = cookieRequest(store.cookieHeader(user, "fixture-session"));
  const guard = new CookieSessionGuard(store, () => ({ id: 1 }));
  for (const disabled of [false, 0, "0", null, "false"]) {
    active = disabled;
    expect(await guard.resolve(request)).toBeNull();
  }
  for (const enabled of [true, 1, "1", undefined]) {
    active = enabled;
    expect(await guard.resolve(request)).toMatchObject({ id: 1 });
  }
  const custom = new CookieSessionStore(sql, secret, undefined, undefined, async () => ({
    ...user,
    is_active: false,
  }));
  expect(await new CookieSessionGuard(custom, () => ({ id: 1 })).resolve(request)).toBeNull();
  await expect(store.create({ ...user, is_active: false })).rejects.toThrow();
  await expect(store.create({ ...user, auth_version: -1 })).rejects.toThrow();
  expect(writes).toBe(0);
});

test("native HTTP resolution rechecks live status across cookie, opaque, JWT and Basic requests", async () => {
  process.env.TENANCY_DRIVER = "none";
  const record = {
    id: 1,
    role: "member",
    name: "Fixture",
    email: "fixture@example.test",
    password: await hashPassword("Fixture!Password123"),
    is_active: true,
    auth_version: 0,
  };
  const directory = directoryFor(record),
    services = container(directory);
  const store = new CookieSessionStore(
    { unsafe: async () => [] },
    secret,
    undefined,
    undefined,
    async () => ({ id: 1, name: record.name, email: record.email, is_active: record.is_active }),
  );
  const auth = new CookieSessionAuthManager(store);
  auth.registerGuard("api", new DatabaseTokenGuard(services));
  auth.registerGuard("jwt", new JwtGuard({ secret, directory }));
  auth.registerGuard("basic", new BasicAuthGuard(services));
  const cookie =
    store
      .cookieHeader({ id: 1, name: record.name, email: record.email }, "fixture-session")
      .split(";")[0] ?? "";
  const headers: Record<string, string>[] = [
    { cookie },
    { authorization: "Bearer opaque-fixture" },
    { authorization: `Bearer ${signJwt({ sub: 1, authVersion: 0 }, { secret })}` },
    { authorization: `Basic ${btoa("fixture@example.test:Fixture!Password123")}` },
  ];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      return new Response(null, { status: (await auth.check(request)) ? 200 : 401 });
    },
  });
  try {
    const statuses = () =>
      Promise.all(
        headers.map(async (h) => {
          const response = await fetch(`http://localhost:${server.port}`, { headers: h });
          await response.text();
          return response.status;
        }),
      );
    expect(await statuses()).toEqual([200, 200, 200, 200]);
    record.is_active = false;
    record.auth_version++;
    expect(await statuses()).toEqual([401, 401, 401, 401]);
    record.is_active = true;
    const response = await fetch(`http://localhost:${server.port}`, { headers: headers[2] });
    expect(response.status).toBe(401);
    await response.text();
  } finally {
    await server.stop(true);
  }
});

test("optional account state fails closed for malformed opt-in data and epochs", () => {
  expect(isAccountActive({})).toBe(true);
  expect(isAccountActive({ is_active: true })).toBe(true);
  expect(isAccountActive({ is_active: false })).toBe(false);
  expect(isAuthUserActive({ id: 1 })).toBe(true);
  expect(isAuthUserActive({ id: 1, isActive: true })).toBe(true);
  expect(isAuthUserActive({ id: 1, isActive: false })).toBe(false);
  for (const state of [null, 0, 1, "false", ""]) {
    const record: AuthUserRecord = { id: 1, role: "member" };
    Object.assign(record, { is_active: state });
    expect(isAccountActive(record)).toBe(false);
  }
  expect(matchesAuthVersion(undefined, undefined)).toBe(true);
  expect(matchesAuthVersion(0, 0)).toBe(true);
  for (const current of [-1, 0.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])
    expect(matchesAuthVersion(current, current)).toBe(false);
  for (const issued of [undefined, null, "0", -1, 0.5, Number.NaN, 1, Number.MAX_SAFE_INTEGER + 1])
    expect(matchesAuthVersion(issued, 0)).toBe(false);
});

test("versioned session parsing rejects malformed fields, expires and preserves configured cookie flags", () => {
  process.env.SESSION_SECRET = secret;
  process.env.SESSION_TTL_SECONDS = "60";
  process.env.SESSION_COOKIE_NAME = "account-fixture";
  process.env.APP_ENV = "production";
  const originalNow = Date.now,
    now = originalNow();
  Date.now = () => now;
  try {
    const cookie = createSessionCookie(1, { authVersion: 0 });
    expect(cookie).toContain("account-fixture=");
    expect(cookie).toContain("HttpOnly; SameSite=Lax");
    expect(cookie).toContain("; Secure");
    const pair = cookie.split(";")[0] ?? "",
      separator = pair.indexOf("="),
      parts = decodeURIComponent(pair.slice(separator + 1)).split(".");
    for (const [index, value] of [
      [1, "0"],
      [1, "01"],
      [2, "9007199254740992"],
      [3, "0"],
      [4, "-1"],
      [4, "x"],
      [4, ""],
    ] as const) {
      const mutated = [...parts];
      mutated[index] = value;
      expect(
        readSession(
          cookieRequest(`${pair.slice(0, separator + 1)}${encodeURIComponent(mutated.join("."))}`),
        ),
      ).toBeNull();
    }
    Date.now = () => now + 61000;
    expect(readSession(cookieRequest(cookie))).toBeNull();
  } finally {
    Date.now = originalNow;
  }
});

test("malformed session cookie encoding is denied through native HTTP and shared session readers", async () => {
  process.env.SESSION_COOKIE_NAME = "malformed-fixture";
  process.env.SESSION_SECRET = secret;
  const store = new CookieSessionStore(
    {
      unsafe: async () => {
        throw new Error("Invalid cookies must not reach storage.");
      },
    },
    secret,
    "malformed-fixture",
  );
  const guard = new CookieSessionGuard(store);
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      return new Response(null, { status: (await guard.resolve(request)) ? 200 : 401 });
    },
  });
  try {
    for (const value of ["%", "%E0%A4", "%GG"]) {
      const response = await fetch(`http://localhost:${server.port}`, {
        headers: { cookie: `malformed-fixture=${value}` },
      });
      expect(response.status).toBe(401);
      await response.text();
      expect(readSession(cookieRequest(`malformed-fixture=${value}`))).toBeNull();
    }
  } finally {
    await server.stop(true);
  }
});

test("database cookie epochs fence stale rows independently of transaction-start timestamps", async () => {
  let sessionVersion = 3;
  const sql = {
    async unsafe<T>(query: string): Promise<T[]> {
      return (
        query.includes("FROM sessions")
          ? [{ user_id: 1, session_created_at: new Date(1000), auth_version: sessionVersion }]
          : [
              {
                id: 1,
                name: "Fixture",
                email: "fixture@example.test",
                is_active: true,
                auth_version: 3,
                session_valid_after: new Date(2000),
              },
            ]
      ) as T[];
    },
  };
  const store = new CookieSessionStore(sql, secret);
  const request = cookieRequest(
    store.cookieHeader(
      { id: 1, name: "Fixture", email: "fixture@example.test" },
      "fixture-session",
    ),
  );
  expect(await store.read(request)).toMatchObject({ id: 1, auth_version: 3 });
  sessionVersion = 2;
  expect(await store.read(request)).toBeNull();
});
