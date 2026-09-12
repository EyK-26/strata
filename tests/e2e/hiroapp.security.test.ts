import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { generateOneTimeToken } from "@getstrata/core/auth/oneTimeToken";
import { absoluteTemporarySignedUrl } from "@getstrata/core/http/signedUrl";
import { generateTotp, generateTotpSecret } from "@getstrata/core/security/totp";
import { createSignedSamlResponse } from "../helpers/samlFixture";

const repoRoot = join(import.meta.dir, "../..");
const hiroappRoot = join(repoRoot, "apps/hiroapp");

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
let stop: (() => Promise<void>) | null = null;
let getSql: ((query?: string, params?: unknown[]) => Promise<unknown>) | null = null;
let sql: { unsafe: (query: string, params?: readonly unknown[]) => Promise<unknown[]> };

beforeAll(async () => {
  process.chdir(hiroappRoot);
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
  process.env.FEATURE_PUBLIC_READS = "false";
  process.env.MAIL_DRIVER = "log";
  process.env.APP_ENV_METRICS = "local";
  process.env.METRICS_TOKEN = "";

  const { bootstrapApp, createAppServer } = await import(
    `${hiroappRoot}/src/bootstrap/createApp.ts`
  );
  const database = await import(`${hiroappRoot}/src/bootstrap/database.ts`);
  const { routes } = await bootstrapApp();
  const server = createAppServer(routes, 0);
  origin = `http://127.0.0.1:${server.port}`;
  sql = database.getSql();
  stop = async () => {
    server.stop();
    await database.closeDatabase();
  };
  getSql = database.getSql as never;
  void getSql;
});

afterAll(async () => {
  if (stop) {
    await stop();
  }
  process.chdir(previousCwd);
  for (const key of Object.keys(process.env)) {
    if (!(key in previousEnv)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, previousEnv);
});

describe("HiroApp security", () => {
  test("health is ok after migrate even with notes RLS", async () => {
    const response = await fetch(`${origin}/health`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
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

  test("API login requires MFA when enabled", async () => {
    const secret = generateTotpSecret();
    await sql.unsafe("UPDATE users SET mfa_enabled = true, mfa_secret = $1 WHERE email = $2", [
      secret,
      "demo@example.com",
    ]);
    const missing = await fetch(`${origin}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "demo@example.com", password: "StrataDemo!ChangeMe" }),
    });
    expect(missing.status).toBe(401);

    const ok = await fetch(`${origin}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "demo@example.com",
        password: "StrataDemo!ChangeMe",
        mfa_code: generateTotp(secret),
      }),
    });
    expect(ok.status).toBe(200);
    await sql.unsafe("UPDATE users SET mfa_enabled = false, mfa_secret = NULL WHERE email = $1", [
      "demo@example.com",
    ]);
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
    const resetUrl = absoluteTemporarySignedUrl("/reset-password", 3600, {
      email: "demo@example.com",
      token: issued.plain,
    });
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

    await sql.unsafe(
      "INSERT INTO tenant (slug, plan, region) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
      ["other", "free", "eu"],
    );
    const tenants = (await sql.unsafe("SELECT id FROM tenant WHERE slug = $1", [
      "other",
    ])) as Array<{
      id: number;
    }>;
    const otherId = tenants[0]?.id ?? 2;
    process.env.SCIM_TENANT_TOKENS = `1:hiroapp-scim-tenant-1,${otherId}:hiroapp-scim-tenant-2`;
    await sql.unsafe(
      "INSERT INTO users (name, email, password, is_admin, tenant_id) VALUES ($1, $2, $3, false, $4) ON CONFLICT (email) DO UPDATE SET tenant_id = $4",
      ["Other", "other-tenant@example.test", "x", otherId],
    );

    const list = await fetch(`${origin}/scim/v2/Users`, {
      headers: { authorization: "Bearer hiroapp-scim-tenant-1" },
    });
    expect(list.status).toBe(200);
    const body = (await list.json()) as { Resources: Array<{ userName: string }> };
    expect(body.Resources.some((row) => row.userName === "other-tenant@example.test")).toBe(false);

    const reverse = await fetch(`${origin}/scim/v2/Users`, {
      headers: { authorization: "Bearer hiroapp-scim-tenant-2" },
    });
    expect(reverse.status).toBe(200);
    const reverseBody = (await reverse.json()) as { Resources: Array<{ userName: string }> };
    expect(reverseBody.Resources.some((row) => row.userName === "demo@example.com")).toBe(false);
    expect(reverseBody.Resources.some((row) => row.userName === "other-tenant@example.test")).toBe(
      true,
    );
  });

  test("metrics are hidden in staging without a token", async () => {
    const previous = process.env.APP_ENV;
    const previousToken = process.env.METRICS_TOKEN;
    process.env.APP_ENV = "staging";
    delete process.env.METRICS_TOKEN;
    try {
      expect((await fetch(`${origin}/metrics`)).status).toBe(404);
    } finally {
      process.env.APP_ENV = previous;
      restoreEnv("METRICS_TOKEN", previousToken);
    }
  });

  test("registration flag returns 404 and static traversal is 404", async () => {
    process.env.FEATURE_REGISTRATION = "false";
    expect((await fetch(`${origin}/register`)).status).toBe(404);
    process.env.FEATURE_REGISTRATION = "true";
    expect((await fetch(`${origin}/assets/../../package.json`)).status).toBe(404);
  });

  test("SAML ACS rejects unsigned and wrong-audience responses and accepts a signed one", async () => {
    const fixture = await createSignedSamlResponse({
      audience: "https://hiroapp.test/saml/metadata",
      destination: `${origin}/auth/saml/acs`,
    });
    process.env.FEATURE_SAML = "true";
    process.env.SAML_IDP_SSO_URL = "https://idp.example.test/sso";
    process.env.SAML_IDP_CERT = fixture.cert;
    process.env.SAML_SP_ENTITY_ID = "https://hiroapp.test/saml/metadata";
    process.env.SAML_ACS_URL = `${origin}/auth/saml/acs`;
    process.env.SAML_IDP_ISSUER = "https://idp.example.test/metadata";

    try {
      const start = await fetch(`${origin}/auth/saml`, { redirect: "manual" });
      expect(start.status).toBe(302);
      const location = start.headers.get("location") ?? "";
      const relayState = new URL(location).searchParams.get("RelayState") ?? "";
      const cookies = cookieHeader(start);

      const unsigned = await createSignedSamlResponse({
        audience: "https://hiroapp.test/saml/metadata",
        destination: `${origin}/auth/saml/acs`,
        signed: false,
      });
      const unsignedRes = await fetch(`${origin}/auth/saml/acs`, {
        method: "POST",
        headers: {
          cookie: cookies,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ SAMLResponse: unsigned.responseB64, RelayState: relayState }),
      });
      expect(unsignedRes.status).toBeGreaterThanOrEqual(400);

      const wrongAud = await createSignedSamlResponse({
        audience: "https://other.test/metadata",
        destination: `${origin}/auth/saml/acs`,
      });
      const wrong = await fetch(`${origin}/auth/saml/acs`, {
        method: "POST",
        headers: {
          cookie: cookies,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ SAMLResponse: wrongAud.responseB64, RelayState: relayState }),
      });
      expect(wrong.status).toBeGreaterThanOrEqual(400);

      const valid = await fetch(`${origin}/auth/saml/acs`, {
        method: "POST",
        headers: {
          cookie: cookies,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ SAMLResponse: fixture.responseB64, RelayState: relayState }),
        redirect: "manual",
      });
      expect([302, 200]).toContain(valid.status);

      const cookielessFixture = await createSignedSamlResponse({
        audience: "https://hiroapp.test/saml/metadata",
        destination: `${origin}/auth/saml/acs`,
        cert: fixture.cert,
        privateKey: fixture.privateKey,
      });
      const cookielessStart = await fetch(`${origin}/auth/saml`, { redirect: "manual" });
      const cookielessRelay =
        new URL(cookielessStart.headers.get("location") ?? "").searchParams.get("RelayState") ?? "";
      const cookieless = await fetch(`${origin}/auth/saml/acs`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          SAMLResponse: cookielessFixture.responseB64,
          RelayState: cookielessRelay,
        }),
        redirect: "manual",
      });
      expect([302, 200]).toContain(cookieless.status);
    } finally {
      process.env.FEATURE_SAML = "false";
      delete process.env.SAML_IDP_SSO_URL;
      delete process.env.SAML_IDP_CERT;
      delete process.env.SAML_SP_ENTITY_ID;
      delete process.env.SAML_ACS_URL;
      delete process.env.SAML_IDP_ISSUER;
    }
  });
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
