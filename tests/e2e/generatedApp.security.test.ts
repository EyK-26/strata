import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { get as httpGet } from "node:http";
import { generateOneTimeToken } from "@getstrata/core/auth/oneTimeToken";
import type { Application } from "@getstrata/core/contracts/application";
import type { PersistenceInvocation } from "@getstrata/core/contracts/persistence";
import { createMfaSecretCodec, protectMfaSecret } from "@getstrata/core/crypto/mfaSecret";
import { absoluteTemporarySignedUrl } from "@getstrata/core/http/signedUrl";
import { requireConfiguredSecret } from "@getstrata/core/runtime/appKeyPrefix";
import { generateTotp, generateTotpSecret } from "@getstrata/core/security/totp";
import { createGeneratedSecurityApp } from "../helpers/generatedSecurityApp";
import { jsonCsrfHeaders } from "../helpers/jsonCsrf";
import { createSignedSamlResponse } from "../helpers/samlFixture";

let fixture: Awaited<ReturnType<typeof createGeneratedSecurityApp>>;
let appRoot: string;

function cookieHeader(response: Response, previous = ""): string {
  const jar = new Map<string, string>();
  for (const part of previous
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)) {
    const [name, ...rest] = part.split("=");
    if (name) {
      jar.set(name, rest.join("="));
    }
  }
  for (const header of response.headers.getSetCookie()) {
    const pair = header.split(";")[0] ?? "";
    const [name, ...rest] = pair.split("=");
    if (name) {
      jar.set(name, rest.join("="));
    }
  }
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

const previousCwd = process.cwd();
const previousEnv = { ...process.env };

let origin = "";
let inspectHealth: (() => Promise<unknown>) | undefined;
let verifyAddressOwnership: (() => Promise<void>) | undefined;
type SecurityApp = {
  application: Application;
  invoke: PersistenceInvocation;
  server: import("bun").Server<unknown>;
  routes: Record<string, unknown>;
};
let mainApp: SecurityApp;
let fixtureUncertain = false;
const owners = new Set<Application>();
let sql: Bun.SQL;
const commandEnvelope = {
  kind: "command",
  actor: { kind: "system", policy: "fixture.generated-security" },
} as const;
async function runtimeQuery<Row>(
  text: string,
  params: readonly unknown[] = [],
): Promise<readonly Row[]> {
  return mainApp.invoke(commandEnvelope, ({ database }) => database.execute<Row>({ text, params }));
}
async function startOwned(
  overrides: Record<string, string | undefined> = {},
  port = 0,
): Promise<SecurityApp> {
  const previous = { ...process.env };
  try {
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    const { createAppServer } = await import(`${appRoot}/src/bootstrap/createApp.ts`);
    const app = await createAppServer({
      migrate: false,
      server: { port, native: { hostname: "127.0.0.1" } },
      onConstructed: (owner: Application) => {
        owners.add(owner);
      },
    });
    expect(app.server).toBeDefined();
    return app;
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
}
async function stopOwner(owner: Application) {
  const result = await owner.stop();
  expect(result.successful).toBe(true);
  owners.delete(owner);
}
async function withOwner(
  overrides: Record<string, string | undefined>,
  work: (app: SecurityApp) => Promise<void>,
  port = 0,
) {
  const failures: unknown[] = [];
  const initialOwners = new Set(owners);
  try {
    const app = await startOwned(overrides, port);
    await work(app);
  } catch (error) {
    failures.push(error);
  }
  for (const owner of [...owners])
    if (!initialOwners.has(owner)) {
      try {
        await stopOwner(owner);
      } catch (error) {
        failures.push(error);
      }
    }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(failures, "Configured security app and cleanup failed");
}
async function reserveAddress() {
  const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const result = { port: reservation.port, origin: reservation.url.origin };
  await reservation.stop(true);
  return result;
}

function idpShapedHeaders(): Record<string, string> {
  return {
    "content-type": "application/x-www-form-urlencoded",
    origin: "https://idp.example.test",
    referer: "https://idp.example.test/sso",
    "sec-fetch-site": "cross-site",
  };
}

beforeAll(async () => {
  fixture = await createGeneratedSecurityApp();
  appRoot = fixture.app;
  process.env.DATABASE_URL = process.env.APP_DATABASE_URL = fixture.runtimeUrl;
  process.env.MIGRATION_DATABASE_URL = fixture.migrationUrl;
  process.chdir(appRoot);
  process.env.APP_ENV = "local";
  process.env.APP_DEBUG = "false";
  process.env.FRONTEND_MODE = "server-htmx";
  process.env.TENANCY_DRIVER = "rls";
  process.env.AUTH_DEV_HEADERS = "false";
  process.env.SESSION_SECRET =
    process.env.SESSION_SECRET || "dev-session-secret-change-me-please-32ch";
  process.env.TOKEN_HASH_PEPPER = process.env.TOKEN_HASH_PEPPER || "dev-token-pepper-change-me";
  process.env.FEATURE_API_TOKENS = "true";
  process.env.FEATURE_SCIM = "true";
  process.env.SCIM_BEARER_TOKEN = "hiroapp-scim-tenant-1";
  process.env.SCIM_TENANT_TOKENS = "1:hiroapp-scim-tenant-1,2:hiroapp-scim-tenant-2";
  process.env.FEATURE_REGISTRATION = "true";
  process.env.FEATURE_SAML = "false";
  process.env.FEATURE_MFA = "true";
  process.env.KMS_ENCRYPTION_KEY =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  process.env.FEATURE_PUBLIC_READS = "false";
  process.env.MAIL_DRIVER = "log";
  process.env.APP_ENV_METRICS = "local";
  process.env.METRICS_TOKEN = "";

  const migrations = await import(`${appRoot}/src/db/migrate.ts`);
  await migrations.migrate();
  await migrations.seed();
  const migrationUrl = process.env.MIGRATION_DATABASE_URL?.trim();
  if (!migrationUrl) throw new Error("MIGRATION_DATABASE_URL is required for fixture setup");
  sql = new Bun.SQL(migrationUrl);
  mainApp = await startOwned();
  const server = mainApp.server;
  expect(server.hostname).toBe("127.0.0.1");
  origin = server.url.origin;
  verifyAddressOwnership = async () => {
    const other = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response("other-service", { status: 401 }),
    });
    const failures: unknown[] = [];
    const initialOwners = new Set(owners);
    try {
      let rejected = false;
      try {
        await startOwned({}, other.port);
      } catch (error) {
        rejected = true;
        const seen = new Set<unknown>();
        const occupied = (value: unknown): boolean => {
          if (!value || typeof value !== "object" || seen.has(value)) return false;
          seen.add(value);
          const row = value as {
            code?: unknown;
            message?: unknown;
            cause?: unknown;
            errors?: readonly unknown[];
          };
          return (
            row.code === "EADDRINUSE" ||
            /EADDRINUSE|address already in use|port.*in use/i.test(String(row.message ?? "")) ||
            occupied(row.cause) ||
            (Array.isArray(row.errors) && row.errors.some(occupied))
          );
        };
        expect(occupied(error)).toBe(true);
      }
      expect(rejected).toBe(true);
      await withOwner({}, async (owned) => {
        expect(owned.server.hostname).toBe("127.0.0.1");
        expect(owned.server.port).not.toBe(other.port);
        const health = await fetch(new URL("/health", owned.server.url), { redirect: "manual" });
        expect(health.status).toBe(200);
        expect(await health.text()).toBe("ok");
        const unrelated = await fetch(other.url);
        expect(unrelated.status).toBe(401);
        expect(await unrelated.text()).toBe("other-service");
      });
    } catch (error) {
      failures.push(error);
    }
    for (const owner of [...owners])
      if (!initialOwners.has(owner)) {
        try {
          await stopOwner(owner);
        } catch (error) {
          failures.push(error);
        }
      }
    try {
      await other.stop(true);
    } catch (error) {
      failures.push(error);
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1)
      throw new AggregateError(failures, "Binding control and cleanup failed");
  };
  inspectHealth = async () => {
    const wire = await new Promise((resolve) => {
      const request = httpGet(
        `${origin}/health`,
        { signal: AbortSignal.timeout(2000) },
        (response) => {
          let body = "";
          response.on("data", (chunk) => {
            body = (body + chunk.toString()).slice(0, 1024);
          });
          response.on("end", () => resolve({ status: response.statusCode, body }));
        },
      );
      request.on("error", (error) => resolve({ error: error.message }));
    });
    return { origin, serverUrl: server.url.href, wire };
  };
}, 150000);

afterAll(async () => {
  const failures: unknown[] = [];
  let ownersClosed = !fixtureUncertain;
  for (const owner of [...owners]) {
    try {
      await stopOwner(owner);
    } catch (error) {
      failures.push(error);
      ownersClosed = false;
    }
  }
  try {
    await sql?.close();
  } catch (error) {
    failures.push(error);
    ownersClosed = false;
  }
  try {
    process.chdir(previousCwd);
  } catch (error) {
    failures.push(error);
  }
  if (ownersClosed) {
    try {
      await fixture?.close();
    } catch (error) {
      failures.push(error);
    }
  } else
    failures.push(
      new Error("Application or SQL termination unconfirmed; security fixture retained"),
    );
  for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key];
  Object.assign(process.env, previousEnv);
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "Security fixture cleanup failed");
});

describe("Generated application security", () => {
  test("generated native binding owns the exact client address despite another local 401 service", async () => {
    expect(verifyAddressOwnership).toBeDefined();
    await verifyAddressOwnership?.();
  });
  afterEach(async () => {
    await sql.unsafe(
      "UPDATE users SET mfa_enabled = false, mfa_secret = NULL, mfa_recovery_codes = NULL WHERE email = $1",
      ["demo@example.com"],
    );
  });

  test("health is ok after migrate even with notes RLS", async () => {
    const response = await fetch(`${origin}/health`, { redirect: "manual" });
    if (response.status !== 200)
      console.error(
        "Generated health diagnostics",
        JSON.stringify({
          responseUrl: response.url,
          contentType: response.headers.get("content-type"),
          server: response.headers.get("server"),
          body: await response.clone().text(),
          probes: await inspectHealth?.(),
        }),
      );
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.text()).toBe("ok");
  });

  test("HiroApp request traffic uses the NOBYPASSRLS APP_DATABASE_URL role", async () => {
    const rows = (await runtimeQuery(
      `SELECT current_user AS rolname, r.rolsuper, r.rolbypassrls
       FROM pg_roles r WHERE r.rolname = current_user`,
    )) as Array<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>;
    expect(rows[0]?.rolname).toBe("strata_app");
    expect(rows[0]?.rolname).not.toBe("postgres");
    expect(rows[0]?.rolsuper).toBe(false);
    expect(rows[0]?.rolbypassrls).toBe(false);
    const health = await fetch(`${origin}/health`);
    expect(health.status).toBe(200);
  });

  test("live role denylist rejects a postgres runtime URL", async () => {
    const { assertRlsLiveDatabaseRole } = await import(
      fixture.resolve("@getstrata/bootstrap/secretsGuard")
    );
    const previousDatabaseUrl = process.env.DATABASE_URL;
    const previousAppUrl = process.env.APP_DATABASE_URL;
    const previousDriver = process.env.TENANCY_DRIVER;
    const previousAppEnv = process.env.APP_ENV;
    const migrationUrl = process.env.MIGRATION_DATABASE_URL?.trim();
    if (!migrationUrl) {
      throw new Error("MIGRATION_DATABASE_URL is required for the superuser runtime URL probe");
    }
    try {
      process.env.APP_ENV = "local";
      process.env.TENANCY_DRIVER = "rls";
      process.env.DATABASE_URL = migrationUrl;
      process.env.APP_DATABASE_URL = migrationUrl;
      let inspections = 0;
      await expect(
        assertRlsLiveDatabaseRole(
          {
            APP_ENV: "local",
            TENANCY_DRIVER: "rls",
            DATABASE_URL: migrationUrl,
            APP_DATABASE_URL: migrationUrl,
          },
          async () => {
            inspections++;
            throw new Error("URL denylist must reject before live inspection");
          },
        ),
      ).rejects.toThrow(/not postgres/);
      expect(inspections).toBe(0);
    } finally {
      restoreEnv("DATABASE_URL", previousDatabaseUrl);
      restoreEnv("APP_DATABASE_URL", previousAppUrl);
      restoreEnv("TENANCY_DRIVER", previousDriver);
      restoreEnv("APP_ENV", previousAppEnv);
    }
    const rows = (await runtimeQuery("SELECT current_user AS rolname")) as Array<{
      rolname: string;
    }>;
    expect(rows[0]?.rolname).toBe("strata_app");
  });

  test("live pg_roles inspect of the HiroApp request pool", async () => {
    expect(process.env.APP_ENV).toBe("local");
    expect(process.env.TENANCY_DRIVER).toBe("rls");
    const { assertRlsLiveDatabaseRole } = await import(
      fixture.resolve("@getstrata/bootstrap/secretsGuard")
    );
    await expect(
      assertRlsLiveDatabaseRole({ ...process.env }, async () => {
        const rows = await runtimeQuery<{
          rolname: string;
          rolsuper: boolean;
          rolbypassrls: boolean;
        }>(
          "SELECT current_user AS rolname, r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname=current_user",
        );
        return rows[0] ?? null;
      }),
    ).resolves.toBeUndefined();
    const rows = (await runtimeQuery(
      `SELECT current_user AS rolname, r.rolsuper, r.rolbypassrls
       FROM pg_roles r WHERE r.rolname = current_user`,
    )) as Array<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>;
    expect(rows[0]?.rolname).toBe("strata_app");
    expect(rows[0]?.rolsuper).toBe(false);
    expect(rows[0]?.rolbypassrls).toBe(false);
  });

  test("empty notes for the current tenant stay 200 and unreadable notes are not 200", async () => {
    const previous = (await sql.unsafe("SELECT body, tenant_id FROM notes")) as Array<{
      body: string;
      tenant_id: number;
    }>;
    try {
      await sql.unsafe("DELETE FROM notes");
      const empty = await fetch(`${origin}/health`);
      expect(empty.status).toBe(200);
      expect(await empty.text()).toBe("ok");

      await sql.unsafe("REVOKE SELECT ON notes FROM strata_app");
      const broken = await fetch(`${origin}/health`);
      expect(broken.status).not.toBe(200);
    } finally {
      await sql.unsafe("GRANT ALL PRIVILEGES ON notes TO strata_app");
      await sql.unsafe("DELETE FROM notes");
      for (const row of previous) {
        await sql.unsafe("INSERT INTO notes (body, tenant_id) VALUES ($1, $2)", [
          row.body,
          row.tenant_id,
        ]);
      }
    }
  });

  test("cookie login requires CSRF and ignores garbage Bearer", async () => {
    const loginPage = await fetch(`${origin}/login`);
    const html = await loginPage.text();
    const csrf = /name="_token" value="([^"]+)"/.exec(html)?.[1] ?? "";
    const cookies = cookieHeader(loginPage);

    const skipped = await fetch(`${origin}/login`, {
      method: "POST",
      headers: {
        cookie: cookies,
        authorization: "Bearer garbage",
        origin,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        email: "demo@example.com",
        password: "StrataDemo!ChangeMe",
      }),
      redirect: "manual",
    });
    expect(skipped.status).toBe(403);

    const signedIn = await fetch(`${origin}/login`, {
      method: "POST",
      headers: {
        cookie: cookies,
        authorization: "Bearer garbage",
        origin,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        _token: csrf,
        email: "demo@example.com",
        password: "StrataDemo!ChangeMe",
      }),
      redirect: "manual",
    });
    expect(signedIn.status).toBe(302);
    expect(signedIn.headers.get("location")).toBe("/");
  });

  test("MFA enroll revokes existing sessions", async () => {
    const loginPage = await fetch(`${origin}/login`);
    const html = await loginPage.text();
    const csrf = /name="_token" value="([^"]+)"/.exec(html)?.[1] ?? "";
    let cookies = cookieHeader(loginPage);
    const signedIn = await fetch(`${origin}/login`, {
      method: "POST",
      headers: {
        cookie: cookies,
        origin,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        _token: csrf,
        email: "demo@example.com",
        password: "StrataDemo!ChangeMe",
      }),
      redirect: "manual",
    });
    expect(signedIn.status).toBe(302);
    cookies = cookieHeader(signedIn, cookies);

    const confirmPage = await fetch(`${origin}/confirm-password?redirect=/account/mfa`, {
      headers: { cookie: cookies },
    });
    const confirmHtml = await confirmPage.text();
    const confirmCsrf = /name="_token" value="([^"]+)"/.exec(confirmHtml)?.[1] ?? "";
    cookies = cookieHeader(confirmPage, cookies);
    const confirmed = await fetch(`${origin}/confirm-password?redirect=/account/mfa`, {
      method: "POST",
      headers: {
        cookie: cookies,
        origin,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        _token: confirmCsrf,
        password: "StrataDemo!ChangeMe",
      }),
      redirect: "manual",
    });
    expect(confirmed.status).toBe(302);
    cookies = cookieHeader(confirmed, cookies);

    const setupPage = await fetch(`${origin}/account/mfa`, { headers: { cookie: cookies } });
    expect(setupPage.status).toBe(200);
    const setupHtml = await setupPage.text();
    const setupCsrf = /name="_token" value="([^"]+)"/.exec(setupHtml)?.[1] ?? "";
    const secret = /name="secret" value="([^"]+)"/.exec(setupHtml)?.[1] ?? "";
    expect(secret).toBeTruthy();
    cookies = cookieHeader(setupPage, cookies);

    const enrolled = await fetch(`${origin}/account/mfa`, {
      method: "POST",
      headers: {
        cookie: cookies,
        origin,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        _token: setupCsrf,
        secret,
        code: generateTotp(secret),
      }),
    });
    expect(enrolled.status).toBe(200);
    expect(await enrolled.text()).toContain("Recovery codes");

    const remaining = (await sql.unsafe(
      "SELECT id FROM sessions WHERE user_id = $1",
      [1],
    )) as unknown[];
    expect(remaining).toHaveLength(0);

    const stale = await fetch(`${origin}/confirm-password`, {
      headers: { cookie: cookies },
      redirect: "manual",
    });
    expect(stale.status).toBe(302);
    expect(stale.headers.get("location") ?? "").toMatch(/\/login/);

    await sql.unsafe(
      "UPDATE users SET mfa_enabled = false, mfa_secret = NULL, mfa_recovery_codes = NULL, session_valid_after = NULL WHERE email = $1",
      ["demo@example.com"],
    );
  });

  test("API login requires CSRF and MFA when enabled", async () => {
    const secret = generateTotpSecret();
    await sql.unsafe("UPDATE users SET mfa_enabled = true, mfa_secret = $1 WHERE email = $2", [
      protectMfaSecret(secret, createMfaSecretCodec(process.env)),
      "demo@example.com",
    ]);
    try {
      const unauthenticated = await fetch(`${origin}/api/v1/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "demo@example.com", password: "StrataDemo!ChangeMe" }),
      });
      expect(unauthenticated.status).toBe(403);

      const csrf = await jsonCsrfHeaders(origin);
      const missing = await fetch(`${origin}/api/v1/auth/login`, {
        method: "POST",
        headers: csrf.headers,
        body: JSON.stringify({ email: "demo@example.com", password: "StrataDemo!ChangeMe" }),
      });
      expect(missing.status).toBe(401);

      const ok = await fetch(`${origin}/api/v1/auth/login`, {
        method: "POST",
        headers: csrf.headers,
        body: JSON.stringify({
          email: "demo@example.com",
          password: "StrataDemo!ChangeMe",
          mfa_code: generateTotp(secret),
        }),
      });
      expect(ok.status).toBe(200);
      const minted = (await ok.json()) as { token?: string };
      expect(minted.token?.startsWith("strp_")).toBe(true);
    } finally {
      await sql.unsafe("UPDATE users SET mfa_enabled = false, mfa_secret = NULL WHERE email = $1", [
        "demo@example.com",
      ]);
    }
  });

  test("foreign Origin plus CSRF cookies does not mint a session", async () => {
    const csrf = await jsonCsrfHeaders(origin);
    const blocked = await fetch(`${origin}/api/v1/auth/login`, {
      method: "POST",
      headers: {
        ...csrf.headers,
        origin: "https://evil.example",
      },
      body: JSON.stringify({ email: "demo@example.com", password: "StrataDemo!ChangeMe" }),
    });
    expect(blocked.status).toBe(403);
    expect(blocked.headers.getSetCookie().some((item) => item.startsWith("strata_session="))).toBe(
      false,
    );

    const jwtBlocked = await fetch(`${origin}/api/auth/token`, {
      method: "POST",
      headers: {
        ...csrf.headers,
        origin: "https://evil.example",
      },
      body: JSON.stringify({ email: "demo@example.com", password: "StrataDemo!ChangeMe" }),
    });
    expect(jwtBlocked.status).toBe(403);
  });

  test("cookie JSON login without Origin is 403", async () => {
    const csrf = await jsonCsrfHeaders(origin);
    const withoutOrigin = {
      "content-type": "application/json",
      "x-csrf-token": csrf.token,
      cookie: csrf.cookie,
    };
    const login = await fetch(`${origin}/api/v1/auth/login`, {
      method: "POST",
      headers: withoutOrigin,
      body: JSON.stringify({ email: "demo@example.com", password: "StrataDemo!ChangeMe" }),
    });
    expect(login.status).toBe(403);
    expect(login.headers.getSetCookie().some((item) => item.startsWith("strata_session="))).toBe(
      false,
    );

    const jwt = await fetch(`${origin}/api/auth/token`, {
      method: "POST",
      headers: withoutOrigin,
      body: JSON.stringify({ email: "demo@example.com", password: "StrataDemo!ChangeMe" }),
    });
    expect(jwt.status).toBe(403);
  });

  // Response identity headers only. This e2e is APP_ENV=local and is not a
  // GuestGuard production proof. That proof is tests/unit/authGuard.test.ts
  // "GuestGuard is always null in production even when AUTH_DEV_HEADERS is true".
  test("identity response headers are absent", async () => {
    const loginPage = await fetch(`${origin}/login`);
    const html = await loginPage.text();
    const csrf = /name="_token" value="([^"]+)"/.exec(html)?.[1] ?? "";
    const cookies = cookieHeader(loginPage);
    const signedIn = await fetch(`${origin}/login`, {
      method: "POST",
      headers: {
        cookie: cookies,
        origin,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        _token: csrf,
        email: "demo@example.com",
        password: "StrataDemo!ChangeMe",
      }),
      redirect: "manual",
    });
    expect(signedIn.status).toBe(302);
    const session = cookieHeader(signedIn, cookies);
    const home = await fetch(`${origin}/`, { headers: { cookie: session } });
    expect(home.status).toBe(200);
    expect(home.headers.get("x-authenticated-user-id")).toBeNull();
    expect(home.headers.get("x-tenant-id")).toBeNull();
    expect(home.headers.get("x-tenant-region")).toBeNull();
  });

  test("MFA enroll stores enc:v1", async () => {
    const loginPage = await fetch(`${origin}/login`);
    const html = await loginPage.text();
    const csrf = /name="_token" value="([^"]+)"/.exec(html)?.[1] ?? "";
    let cookies = cookieHeader(loginPage);
    const signedIn = await fetch(`${origin}/login`, {
      method: "POST",
      headers: {
        cookie: cookies,
        origin,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        _token: csrf,
        email: "demo@example.com",
        password: "StrataDemo!ChangeMe",
      }),
      redirect: "manual",
    });
    expect(signedIn.status).toBe(302);
    cookies = cookieHeader(signedIn, cookies);

    const confirmPage = await fetch(`${origin}/confirm-password?redirect=/account/mfa`, {
      headers: { cookie: cookies },
    });
    const confirmHtml = await confirmPage.text();
    const confirmCsrf = /name="_token" value="([^"]+)"/.exec(confirmHtml)?.[1] ?? "";
    cookies = cookieHeader(confirmPage, cookies);
    const confirmed = await fetch(`${origin}/confirm-password?redirect=/account/mfa`, {
      method: "POST",
      headers: {
        cookie: cookies,
        origin,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        _token: confirmCsrf,
        password: "StrataDemo!ChangeMe",
      }),
      redirect: "manual",
    });
    expect(confirmed.status).toBe(302);
    cookies = cookieHeader(confirmed, cookies);

    const setupPage = await fetch(`${origin}/account/mfa`, { headers: { cookie: cookies } });
    expect(setupPage.status).toBe(200);
    const setupHtml = await setupPage.text();
    const setupCsrf = /name="_token" value="([^"]+)"/.exec(setupHtml)?.[1] ?? "";
    const secret = /name="secret" value="([^"]+)"/.exec(setupHtml)?.[1] ?? "";
    expect(secret).toBeTruthy();
    cookies = cookieHeader(setupPage, cookies);

    const enrolled = await fetch(`${origin}/account/mfa`, {
      method: "POST",
      headers: {
        cookie: cookies,
        origin,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        _token: setupCsrf,
        secret,
        code: generateTotp(secret),
      }),
    });
    expect(enrolled.status).toBe(200);

    const stored = (await sql.unsafe("SELECT mfa_secret FROM users WHERE email = $1", [
      "demo@example.com",
    ])) as Array<{ mfa_secret: string | null }>;
    expect(stored[0]?.mfa_secret?.startsWith("enc:v1:")).toBe(true);

    await sql.unsafe(
      "UPDATE users SET mfa_enabled = false, mfa_secret = NULL, mfa_recovery_codes = NULL, session_valid_after = NULL WHERE email = $1",
      ["demo@example.com"],
    );
  });

  test("password reset works once and rejects the previous session", async () => {
    const loginPage = await fetch(`${origin}/login`);
    const html = await loginPage.text();
    const csrf = /name="_token" value="([^"]+)"/.exec(html)?.[1] ?? "";
    let cookies = cookieHeader(loginPage);
    const signedIn = await fetch(`${origin}/login`, {
      method: "POST",
      headers: {
        cookie: cookies,
        origin,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        _token: csrf,
        email: "demo@example.com",
        password: "StrataDemo!ChangeMe",
      }),
      redirect: "manual",
    });
    expect(signedIn.status).toBe(302);
    cookies = cookieHeader(signedIn, cookies);

    const issued = generateOneTimeToken();
    await sql.unsafe(
      "INSERT INTO auth_one_time_tokens (purpose, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)",
      ["password_reset", 1, issued.hash, new Date(Date.now() + 3600_000).toISOString()],
    );
    const resetUrl = absoluteTemporarySignedUrl(
      "/reset-password",
      3600,
      {
        email: "demo@example.com",
        token: issued.plain,
      },
      process.env.APP_URL ?? "http://localhost:3000",
      requireConfiguredSecret(
        ["SIGNED_URL_SECRET", "SESSION_SECRET", "OAUTH_STATE_SECRET"],
        "signed-url-secret",
        process.env,
      ),
    );
    const resetParsed = new URL(resetUrl, origin);
    const resetPath = `${resetParsed.pathname}${resetParsed.search}`;
    const resetPage = await fetch(`${origin}${resetPath}`);
    const resetHtml = await resetPage.text();
    const resetCsrf = /name="_token" value="([^"]+)"/.exec(resetHtml)?.[1] ?? "";
    cookies = cookieHeader(resetPage, cookies);

    const reset = await fetch(`${origin}${resetPath}`, {
      method: "POST",
      headers: {
        cookie: cookies,
        origin,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        _token: resetCsrf,
        email: "demo@example.com",
        password: "StrataDemo!ChangeMe",
      }),
      redirect: "manual",
    });
    expect(reset.status).toBe(302);

    const reused = await fetch(`${origin}${resetPath}`, {
      method: "POST",
      headers: {
        cookie: cookies,
        origin,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        _token: resetCsrf,
        email: "demo@example.com",
        password: "StrataDemo!ChangeMe",
      }),
      redirect: "manual",
    });
    if (reused.status === 200) {
      expect(await reused.text()).toContain("Invalid or expired reset link.");
    } else {
      expect(reused.status).toBeGreaterThanOrEqual(400);
    }

    const remaining = (await sql.unsafe(
      "SELECT id FROM sessions WHERE user_id = $1",
      [1],
    )) as unknown[];
    expect(remaining).toHaveLength(0);

    const oldCookie = cookies;
    const protectedPage = await fetch(`${origin}/confirm-password`, {
      headers: { cookie: oldCookie },
      redirect: "manual",
    });
    expect(protectedPage.status).toBe(302);
    expect(protectedPage.headers.get("location") ?? "").toMatch(/\/login/);

    const loginAgainPage = await fetch(`${origin}/login`);
    const loginAgainHtml = await loginAgainPage.text();
    const loginAgainCsrf = /name="_token" value="([^"]+)"/.exec(loginAgainHtml)?.[1] ?? "";
    let freshCookies = cookieHeader(loginAgainPage);
    const signedInAgain = await fetch(`${origin}/login`, {
      method: "POST",
      headers: {
        cookie: freshCookies,
        origin,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        _token: loginAgainCsrf,
        email: "demo@example.com",
        password: "StrataDemo!ChangeMe",
      }),
      redirect: "manual",
    });
    expect(signedInAgain.status).toBe(302);
    expect(signedInAgain.headers.get("location")).toBe("/");
    freshCookies = cookieHeader(signedInAgain, freshCookies);
    const newProtected = await fetch(`${origin}/confirm-password`, {
      headers: { cookie: freshCookies },
      redirect: "manual",
    });
    expect(newProtected.status).toBe(200);
    const staleProtected = await fetch(`${origin}/confirm-password`, {
      headers: { cookie: oldCookie },
      redirect: "manual",
    });
    expect(staleProtected.status).toBe(302);
    expect(staleProtected.headers.get("location") ?? "").toMatch(/\/login/);
  });

  test("verify GET does not set a session cookie", async () => {
    const response = await fetch(`${origin}/email/verify`);
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie().some((item) => item.startsWith("strata_session="))).toBe(
      false,
    );
  });

  test("SCIM empty token is 401 and tenant tokens cannot read another tenant", async () => {
    expect((await fetch(`${origin}/scim/v2/Users`)).status).toBe(401);
    expect(
      (await fetch(`${origin}/scim/v2/Users`, { headers: { authorization: "Bearer " } })).status,
    ).toBe(401);

    await sql.unsafe("INSERT INTO tenant (slug) VALUES ($1) ON CONFLICT DO NOTHING", ["other"]);
    const tenants = (await sql.unsafe("SELECT id FROM tenant WHERE slug = $1", [
      "other",
    ])) as Array<{
      id: number;
    }>;
    const otherId = tenants[0]?.id;
    if (!otherId) throw new Error("SCIM fixture tenant allocation returned no identifier");
    expect(otherId).toBeGreaterThan(1);
    await sql.unsafe(
      "INSERT INTO users (name, email, password, is_admin, tenant_id) VALUES ($1, $2, $3, false, $4) ON CONFLICT (email) DO UPDATE SET tenant_id = $4",
      ["Other", "other-tenant@example.test", "x", otherId],
    );

    await withOwner(
      { SCIM_TENANT_TOKENS: `1:hiroapp-scim-tenant-1,${otherId}:hiroapp-scim-tenant-2` },
      async (app) => {
        const origin = app.server.url.origin;
        const list = await fetch(`${origin}/scim/v2/Users`, {
          headers: { authorization: "Bearer hiroapp-scim-tenant-1" },
        });
        expect(list.status).toBe(200);
        const body = (await list.json()) as { Resources: Array<{ userName: string }> };
        expect(body.Resources.some((row) => row.userName === "other-tenant@example.test")).toBe(
          false,
        );

        const reverse = await fetch(`${origin}/scim/v2/Users`, {
          headers: { authorization: "Bearer hiroapp-scim-tenant-2" },
        });
        expect(reverse.status).toBe(200);
        const reverseBody = (await reverse.json()) as { Resources: Array<{ userName: string }> };
        expect(reverseBody.Resources.some((row) => row.userName === "demo@example.com")).toBe(
          false,
        );
        expect(
          reverseBody.Resources.some((row) => row.userName === "other-tenant@example.test"),
        ).toBe(true);
      },
    );
  });

  test("metrics are hidden in staging without a token", async () => {
    const role = `strata_staging_${crypto.randomUUID().replaceAll("-", "")}`;
    const password = crypto.randomUUID().replaceAll("-", "");
    const stagingUrl = new URL(fixture.runtimeUrl);
    stagingUrl.username = role;
    stagingUrl.password = password;
    const database = decodeURIComponent(stagingUrl.pathname.slice(1));
    if (!database || !/^[A-Za-z0-9_]+$/.test(database))
      throw new Error("Unsafe staging fixture database name");
    const initialOwners = new Set(owners);
    const failures: unknown[] = [];
    let roleAttempted = false;
    let roleCreated = false;
    let credentialProbe: Bun.SQL | undefined;
    let probeClosed = true;
    try {
      expect(
        await sql.unsafe("SELECT rolname FROM pg_roles WHERE rolname=$1", [role]),
      ).toHaveLength(0);
      roleAttempted = true;
      await sql.unsafe(
        `CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`,
      );
      roleCreated = true;
      await sql.unsafe(`GRANT CONNECT ON DATABASE ${database} TO ${role}`);
      await sql.unsafe(`GRANT USAGE ON SCHEMA public TO ${role}`);
      credentialProbe = new Bun.SQL(stagingUrl.toString());
      probeClosed = false;
      const rows = await credentialProbe.unsafe(
        "SELECT current_user AS rolname, r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname=current_user",
      );
      expect(rows).toEqual([{ rolname: role, rolsuper: false, rolbypassrls: false }]);
      await withOwner(
        {
          APP_ENV: "staging",
          DATABASE_URL: stagingUrl.toString(),
          APP_DATABASE_URL: stagingUrl.toString(),
          APP_URL: "https://security.example.test",
          METRICS_TOKEN: undefined,
          API_TOKEN_DEFAULT_EXPIRY_DAYS: "30",
          ADMIN_API_TOKEN: undefined,
          MEMBER_API_TOKEN: undefined,
          STRIPE_WEBHOOK_SECRET: undefined,
          SESSION_SECRET: "a7bd4c015b82484ba27e06788fe79bd3451a",
          TOKEN_HASH_PEPPER: "security-owned-pepper-7a29c",
          JWT_SECRET: "a7bd4c015b82484ba27e06788fe79bd3451b",
          OAUTH_STATE_SECRET: "a7bd4c015b82484ba27e06788fe79bd3451c",
          SCIM_BEARER_TOKEN: "security-owned-scim-7a29c",
        },
        async (app) => {
          const actual = await app.invoke(commandEnvelope, ({ database }) =>
            database.execute<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>({
              text: "SELECT current_user AS rolname, r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname=current_user",
              params: [],
            }),
          );
          expect(actual).toEqual([{ rolname: role, rolsuper: false, rolbypassrls: false }]);
          expect((await fetch(new URL("/metrics", app.server.url))).status).toBe(404);
        },
      );
    } catch (error) {
      failures.push(error);
    }
    const applicationClosed = [...owners].every((owner) => initialOwners.has(owner));
    if (applicationClosed && credentialProbe) {
      try {
        await credentialProbe.close();
        probeClosed = true;
      } catch (error) {
        failures.push(error);
      }
    }
    if (roleAttempted && applicationClosed && probeClosed) {
      try {
        const present = await sql.unsafe("SELECT rolname FROM pg_roles WHERE rolname=$1", [role]);
        if (present.length) {
          if (!roleCreated)
            throw new Error(`Staging role creation outcome uncertain; retained: ${role}`);
          await sql.unsafe(`DROP OWNED BY ${role}`);
          await sql.unsafe(`DROP ROLE ${role}`);
        }
        expect(
          await sql.unsafe("SELECT rolname FROM pg_roles WHERE rolname=$1", [role]),
        ).toHaveLength(0);
      } catch (error) {
        fixtureUncertain = true;
        failures.push(error);
      }
    }
    if (!applicationClosed || !probeClosed) {
      fixtureUncertain = true;
      failures.push(
        new Error(
          `Staging app/client termination unconfirmed; owned role and fixture retained: ${role}`,
        ),
      );
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1)
      throw new AggregateError(failures, "Staging metrics case and owned cleanup failed");
  });

  test("registration flag returns 404 and static traversal is 404", async () => {
    await withOwner({ FEATURE_REGISTRATION: "false" }, async (app) => {
      expect((await fetch(new URL("/register", app.server.url))).status).toBe(404);
    });
    expect((await fetch(`${origin}/assets/../../package.json`)).status).toBe(404);
  });

  test("IdP-shaped ACS POST without app cookies rejects unsigned, wrong audience, and wrong issuer", async () => {
    const address = await reserveAddress();
    const origin = address.origin;
    const fixture = await createSignedSamlResponse({
      audience: "https://hiroapp.test/saml/metadata",
      destination: `${origin}/auth/saml/acs`,
    });
    await withOwner(
      {
        FEATURE_SAML: "true",
        SAML_IDP_SSO_URL: "https://idp.example.test/sso",
        SAML_IDP_CERT: fixture.cert,
        SAML_SP_ENTITY_ID: "https://hiroapp.test/saml/metadata",
        SAML_ACS_URL: `${origin}/auth/saml/acs`,
        SAML_IDP_ISSUER: "https://idp.example.test/metadata",
        APP_URL: origin,
      },
      async () => {
        const failures: unknown[] = [];
        try {
          const start = await fetch(`${origin}/auth/saml`, { redirect: "manual" });
          expect(start.status).toBe(302);
          const relayState =
            new URL(start.headers.get("location") ?? "").searchParams.get("RelayState") ?? "";
          expect(relayState.length).toBeGreaterThan(0);

          const unsigned = await createSignedSamlResponse({
            audience: "https://hiroapp.test/saml/metadata",
            destination: `${origin}/auth/saml/acs`,
            signed: false,
          });
          const unsignedRes = await fetch(`${origin}/auth/saml/acs`, {
            method: "POST",
            headers: idpShapedHeaders(),
            body: new URLSearchParams({
              SAMLResponse: unsigned.responseB64,
              RelayState: relayState,
            }),
          });
          expect(unsignedRes.status).toBeGreaterThanOrEqual(400);

          const wrongAud = await createSignedSamlResponse({
            audience: "https://other.test/metadata",
            destination: `${origin}/auth/saml/acs`,
            cert: fixture.cert,
            privateKey: fixture.privateKey,
          });
          const wrong = await fetch(`${origin}/auth/saml/acs`, {
            method: "POST",
            headers: idpShapedHeaders(),
            body: new URLSearchParams({
              SAMLResponse: wrongAud.responseB64,
              RelayState: relayState,
            }),
          });
          expect(wrong.status).toBeGreaterThanOrEqual(400);

          const evilIssuer = await createSignedSamlResponse({
            audience: "https://hiroapp.test/saml/metadata",
            destination: `${origin}/auth/saml/acs`,
            issuer: "https://evil.example/idp",
            cert: fixture.cert,
            privateKey: fixture.privateKey,
          });
          const evil = await fetch(`${origin}/auth/saml/acs`, {
            method: "POST",
            headers: idpShapedHeaders(),
            body: new URLSearchParams({
              SAMLResponse: evilIssuer.responseB64,
              RelayState: relayState,
            }),
          });
          expect(evil.status).toBeGreaterThanOrEqual(400);

          const cookielessFixture = await createSignedSamlResponse({
            audience: "https://hiroapp.test/saml/metadata",
            destination: `${origin}/auth/saml/acs`,
            cert: fixture.cert,
            privateKey: fixture.privateKey,
          });
          const cookielessStart = await fetch(`${origin}/auth/saml`, { redirect: "manual" });
          const cookielessRelay =
            new URL(cookielessStart.headers.get("location") ?? "").searchParams.get("RelayState") ??
            "";
          const cookieless = await fetch(`${origin}/auth/saml/acs`, {
            method: "POST",
            headers: idpShapedHeaders(),
            body: new URLSearchParams({
              SAMLResponse: cookielessFixture.responseB64,
              RelayState: cookielessRelay,
            }),
            redirect: "manual",
          });
          expect(cookieless.status).toBe(302);
          expect(cookieless.headers.get("location")).toBe("/");

          const secret = generateTotpSecret();
          await sql.unsafe(
            "UPDATE users SET mfa_enabled = true, mfa_secret = $1 WHERE email = $2",
            [protectMfaSecret(secret, createMfaSecretCodec(process.env)), "demo@example.com"],
          );
          const mfaStart = await fetch(`${origin}/auth/saml`, { redirect: "manual" });
          const mfaRelay =
            new URL(mfaStart.headers.get("location") ?? "").searchParams.get("RelayState") ?? "";
          const mfaFixture = await createSignedSamlResponse({
            audience: "https://hiroapp.test/saml/metadata",
            destination: `${origin}/auth/saml/acs`,
            email: "demo@example.com",
            cert: fixture.cert,
            privateKey: fixture.privateKey,
          });
          const mfaAcs = await fetch(`${origin}/auth/saml/acs`, {
            method: "POST",
            headers: idpShapedHeaders(),
            body: new URLSearchParams({
              SAMLResponse: mfaFixture.responseB64,
              RelayState: mfaRelay,
            }),
            redirect: "manual",
          });
          expect(mfaAcs.status).toBe(302);
          expect(mfaAcs.headers.get("location")).toBe("/login/mfa");
          expect(
            mfaAcs.headers.getSetCookie().some((item) => item.startsWith("strata_mfa_pending=")),
          ).toBe(true);
        } catch (error) {
          failures.push(error);
        }
        try {
          await sql.unsafe(
            "UPDATE users SET mfa_enabled = false, mfa_secret = NULL WHERE email = $1",
            ["demo@example.com"],
          );
        } catch (error) {
          failures.push(error);
        }
        if (failures.length === 1) throw failures[0];
        if (failures.length > 1) throw new AggregateError(failures, "SAML case and cleanup failed");
      },
      address.port,
    );
  });

  test("JWT mint requires CSRF", async () => {
    const blocked = await fetch(`${origin}/api/auth/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "demo@example.com", password: "StrataDemo!ChangeMe" }),
    });
    expect(blocked.status).toBe(403);

    const csrf = await jsonCsrfHeaders(origin);
    const minted = await fetch(`${origin}/api/auth/token`, {
      method: "POST",
      headers: csrf.headers,
      body: JSON.stringify({ email: "demo@example.com", password: "StrataDemo!ChangeMe" }),
    });
    expect(minted.status).toBe(200);
    const body = (await minted.json()) as { token: string };
    expect(body.token.split(".").length).toBe(3);
  });

  test("cookie login still works for a user in another tenant", async () => {
    await sql.unsafe("INSERT INTO tenant (slug) VALUES ($1) ON CONFLICT (slug) DO NOTHING", [
      "second",
    ]);
    const tenants = (await sql.unsafe("SELECT id FROM tenant WHERE slug = $1", [
      "second",
    ])) as Array<{ id: number }>;
    const tenantId = tenants[0]?.id;
    expect(tenantId).toBeTruthy();
    const demo = (await sql.unsafe("SELECT password FROM users WHERE email = $1", [
      "demo@example.com",
    ])) as Array<{ password: string }>;
    await sql.unsafe(
      "INSERT INTO users (name, email, password, is_admin, tenant_id, email_verified_at) VALUES ($1, $2, $3, false, $4, $5) ON CONFLICT (email) DO UPDATE SET tenant_id = $4, password = $3",
      [
        "Second Tenant",
        "second-tenant@example.test",
        demo[0]?.password,
        tenantId,
        new Date().toISOString(),
      ],
    );

    const loginPage = await fetch(`${origin}/login`);
    const html = await loginPage.text();
    const csrf = /name="_token" value="([^"]+)"/.exec(html)?.[1] ?? "";
    const cookies = cookieHeader(loginPage);
    const signedIn = await fetch(`${origin}/login`, {
      method: "POST",
      headers: {
        cookie: cookies,
        origin,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        _token: csrf,
        email: "second-tenant@example.test",
        password: "StrataDemo!ChangeMe",
      }),
      redirect: "manual",
    });
    expect(signedIn.status).toBe(302);
    expect(signedIn.headers.get("location")).toBe("/");
    const userRows = (await sql.unsafe("SELECT id FROM users WHERE email = $1", [
      "second-tenant@example.test",
    ])) as Array<{ id: number }>;
    const sessions = (await sql.unsafe("SELECT id FROM sessions WHERE user_id = $1", [
      userRows[0]?.id,
    ])) as unknown[];
    expect(sessions.length).toBeGreaterThan(0);
  });

  test("identifier bypass cannot SELECT every user", async () => {
    const identify = (identifier: string, text: string, params: readonly unknown[] = []) =>
      mainApp.invoke(commandEnvelope, ({ database, policy }) =>
        policy.run(database, { kind: "identifier", identifier }, (child) =>
          child.execute<{ email: string }>({ text, params }),
        ),
      );
    const leaked = await identify("x", "SELECT email FROM users");
    expect(leaked.some((row) => row.email === "demo@example.com")).toBe(false);
    expect(leaked.some((row) => row.email === "rls-other@example.test")).toBe(false);
    const pinned = await identify("demo@example.com", "SELECT email FROM users WHERE email=$1", [
      "demo@example.com",
    ]);
    expect(pinned).toEqual([{ email: "demo@example.com" }]);

    const loginPage = await fetch(`${origin}/login`);
    const html = await loginPage.text();
    const csrf = /name="_token" value="([^"]+)"/.exec(html)?.[1] ?? "";
    const cookies = cookieHeader(loginPage);
    const signedIn = await fetch(`${origin}/login`, {
      method: "POST",
      headers: {
        cookie: cookies,
        origin,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        _token: csrf,
        email: "demo@example.com",
        password: "StrataDemo!ChangeMe",
      }),
      redirect: "manual",
    });
    expect(signedIn.status).toBe(302);
    expect(signedIn.headers.get("location")).toBe("/");
  });

  test("unbounded bypass SET LOCAL does not leak onto the next pool checkout", async () => {
    const inside = await mainApp.invoke(commandEnvelope, ({ database, policy }) =>
      policy.run(database, { kind: "bypass" }, (child) =>
        child.execute<{ bypass: string | null }>({
          text: "SELECT current_setting('app.bypass_rls',true) AS bypass",
          params: [],
        }),
      ),
    );
    expect(inside[0]?.bypass).toBe("true");
    const after = await runtimeQuery<{ bypass: string | null }>(
      "SELECT current_setting('app.bypass_rls',true) AS bypass",
    );
    expect(after[0]?.bypass).not.toBe("true");

    const loginPage = await fetch(`${origin}/login`);
    const html = await loginPage.text();
    const csrf = /name="_token" value="([^"]+)"/.exec(html)?.[1] ?? "";
    const cookies = cookieHeader(loginPage);
    const signedIn = await fetch(`${origin}/login`, {
      method: "POST",
      headers: {
        cookie: cookies,
        origin,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        _token: csrf,
        email: "demo@example.com",
        password: "StrataDemo!ChangeMe",
      }),
      redirect: "manual",
    });
    expect(signedIn.status).toBe(302);
  });

  test("FORCE RLS hides other-tenant users, sessions, and api_tokens from a NOBYPASSRLS login role", async () => {
    const role = `strata_e2e_${crypto.randomUUID().replaceAll("-", "")}`;
    const password = "strata-app-e2e-secret";
    const databases = (await sql.unsafe("SELECT current_database() AS name")) as Array<{
      name: string;
    }>;
    const database = databases[0]?.name;
    if (!database || database.replace(/[^A-Za-z0-9_]/g, "") !== database) {
      throw new Error(`Refusing GRANT CONNECT on unsafe database name: ${database}`);
    }

    const failures: unknown[] = [];
    let roleAttempted = false;
    let roleCreated = false;
    let probe: Bun.SQL | undefined;
    let probeClosed = true;
    try {
      expect(
        await sql.unsafe("SELECT rolname FROM pg_roles WHERE rolname=$1", [role]),
      ).toHaveLength(0);
      roleAttempted = true;
      await sql.unsafe(
        `CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`,
      );
      roleCreated = true;
      await sql.unsafe(`GRANT CONNECT ON DATABASE ${database} TO ${role}`);
      await sql.unsafe(`GRANT USAGE ON SCHEMA public TO ${role}`);
      await sql.unsafe(`GRANT SELECT ON notes, users, sessions, api_tokens TO ${role}`);

      const attrs = (await sql.unsafe(
        "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1",
        [role],
      )) as Array<{ rolsuper: boolean; rolbypassrls: boolean }>;
      expect(attrs[0]?.rolsuper).toBe(false);
      expect(attrs[0]?.rolbypassrls).toBe(false);

      await sql.unsafe("INSERT INTO tenant (slug) VALUES ($1) ON CONFLICT (slug) DO NOTHING", [
        "rls-probe",
      ]);
      const tenants = (await sql.unsafe("SELECT id FROM tenant WHERE slug = $1", [
        "rls-probe",
      ])) as Array<{ id: number }>;
      const otherTenantId = tenants[0]?.id;
      await sql.unsafe("INSERT INTO notes (body, tenant_id) VALUES ($1, $2)", [
        "other-tenant-note",
        otherTenantId,
      ]);
      const demo = (await sql.unsafe("SELECT id, password FROM users WHERE email = $1", [
        "demo@example.com",
      ])) as Array<{ id: number; password: string }>;
      await sql.unsafe(
        "INSERT INTO users (name, email, password, is_admin, tenant_id, email_verified_at) VALUES ($1, $2, $3, false, $4, $5) ON CONFLICT (email) DO UPDATE SET tenant_id = $4, password = $3",
        [
          "RLS Probe Other",
          "rls-other@example.test",
          demo[0]?.password,
          otherTenantId,
          new Date().toISOString(),
        ],
      );
      const otherUsers = (await sql.unsafe("SELECT id FROM users WHERE email = $1", [
        "rls-other@example.test",
      ])) as Array<{ id: number }>;
      const otherUserId = otherUsers[0]?.id;
      const sameUserId = demo[0]?.id;
      expect(otherUserId).toBeTruthy();
      expect(sameUserId).toBeTruthy();
      await sql.unsafe(
        "INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET user_id = $2",
        ["rls-other-session", otherUserId, new Date(Date.now() + 3600_000).toISOString()],
      );
      await sql.unsafe(
        "INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET user_id = $2",
        ["rls-same-session", sameUserId, new Date(Date.now() + 3600_000).toISOString()],
      );
      await sql.unsafe(
        "INSERT INTO api_tokens (user_id, name, token_hash) VALUES ($1, $2, $3) ON CONFLICT (token_hash) DO UPDATE SET user_id = $1",
        [otherUserId, "rls-other-token", "rls-other-token-hash"],
      );
      await sql.unsafe(
        "INSERT INTO api_tokens (user_id, name, token_hash) VALUES ($1, $2, $3) ON CONFLICT (token_hash) DO UPDATE SET user_id = $1",
        [sameUserId, "rls-same-token", "rls-same-token-hash"],
      );

      const asSuperuserNotes = (await sql.unsafe("SELECT body FROM notes WHERE body = $1", [
        "other-tenant-note",
      ])) as Array<{ body: string }>;
      expect(asSuperuserNotes.some((row) => row.body === "other-tenant-note")).toBe(true);
      const asSuperuserUsers = (await sql.unsafe("SELECT email FROM users WHERE email = $1", [
        "rls-other@example.test",
      ])) as Array<{ email: string }>;
      expect(asSuperuserUsers).toHaveLength(1);
      const asSuperuserSessions = (await sql.unsafe("SELECT id FROM sessions WHERE id = $1", [
        "rls-other-session",
      ])) as Array<{ id: string }>;
      expect(asSuperuserSessions).toHaveLength(1);
      const asSuperuserTokens = (await sql.unsafe(
        "SELECT name FROM api_tokens WHERE token_hash = $1",
        ["rls-other-token-hash"],
      )) as Array<{ name: string }>;
      expect(asSuperuserTokens).toHaveLength(1);

      const appUrl = process.env.APP_DATABASE_URL?.trim();
      if (!appUrl) {
        throw new Error("APP_DATABASE_URL is required for the RLS login probe");
      }
      const probeUrl = new URL(appUrl);
      probeUrl.username = role;
      probeUrl.password = password;
      probe = new Bun.SQL(probeUrl.toString());
      probeClosed = false;
      await probe.begin(async (appSql) => {
        await appSql.unsafe("SELECT set_config('app.tenant_id', $1, false)", ["1"]);
        await appSql.unsafe("SELECT set_config('app.bypass_rls', $1, false)", ["false"]);
        expect(
          (await appSql.unsafe("SELECT body FROM notes WHERE body = $1", [
            "other-tenant-note",
          ])) as unknown[],
        ).toHaveLength(0);
        expect(
          (await appSql.unsafe("SELECT body FROM notes WHERE body = $1", [
            "Welcome to Strata!",
          ])) as Array<{ body: string }>,
        ).toEqual(expect.arrayContaining([{ body: "Welcome to Strata!" }]));
        expect(
          (await appSql.unsafe("SELECT email FROM users WHERE email = $1", [
            "rls-other@example.test",
          ])) as unknown[],
        ).toHaveLength(0);
        expect(
          (await appSql.unsafe("SELECT email FROM users WHERE email = $1", [
            "demo@example.com",
          ])) as Array<{ email: string }>,
        ).toEqual(expect.arrayContaining([{ email: "demo@example.com" }]));
        expect(
          (await appSql.unsafe("SELECT id FROM sessions WHERE id = $1", [
            "rls-other-session",
          ])) as unknown[],
        ).toHaveLength(0);
        expect(
          (await appSql.unsafe("SELECT id FROM sessions WHERE id = $1", [
            "rls-same-session",
          ])) as Array<{
            id: string;
          }>,
        ).toEqual([{ id: "rls-same-session" }]);
        expect(
          (await appSql.unsafe("SELECT name FROM api_tokens WHERE token_hash = $1", [
            "rls-other-token-hash",
          ])) as unknown[],
        ).toHaveLength(0);
        expect(
          (await appSql.unsafe("SELECT name FROM api_tokens WHERE token_hash = $1", [
            "rls-same-token-hash",
          ])) as Array<{ name: string }>,
        ).toEqual([{ name: "rls-same-token" }]);
      });
    } catch (error) {
      failures.push(error);
    }
    if (probe) {
      try {
        await probe.close();
        probeClosed = true;
      } catch (error) {
        failures.push(error);
      }
    }
    if (roleAttempted && probeClosed) {
      try {
        const present = await sql.unsafe("SELECT rolname FROM pg_roles WHERE rolname=$1", [role]);
        if (present.length) {
          if (!roleCreated) {
            fixtureUncertain = true;
            throw new Error(
              `Role creation outcome uncertain; unique attempted role retained: ${role}`,
            );
          }
          await sql.unsafe(`DROP OWNED BY ${role}`);
          await sql.unsafe(`DROP ROLE ${role}`);
        }
        expect(
          await sql.unsafe("SELECT rolname FROM pg_roles WHERE rolname=$1", [role]),
        ).toHaveLength(0);
      } catch (error) {
        fixtureUncertain = true;
        failures.push(error);
      }
    }
    if (!probeClosed) {
      fixtureUncertain = true;
      failures.push(new Error(`Probe SQL termination unconfirmed; owned role retained: ${role}`));
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1)
      throw new AggregateError(failures, "FORCE RLS probe and cleanup failed");
  });
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
