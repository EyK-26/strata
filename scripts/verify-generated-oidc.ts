/** Packed external application + owned HTTP IdP. No fetch mocks or framework JWT signer. */
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { join } from "node:path";
import { createGeneratedSecurityApp } from "../tests/helpers/generatedSecurityApp.ts";
import { mergeCookies } from "../tests/helpers/jsonCsrf.ts";

const engine = process.argv[2];
assert.ok(engine === "postgres" || engine === "sqlite" || engine === "mysql");
const fixture = await createGeneratedSecurityApp(engine, ["--oidc"]);
const prefix = `oidc_${crypto.randomUUID().replaceAll("-", "")}`;
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const wrongKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
const codes = new Map<string, URLSearchParams>();
let mode = "valid";
let email = "DEMO@EXAMPLE.COM";
let tokenRequests = 0;
let jwksRequests = 0;
let protocolFailure: unknown;
let origin = "";
let issuer = "";
const idp = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    try {
      const url = new URL(request.url);
      if (url.pathname === "/.well-known/openid-configuration")
        return Response.json({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
        });
      if (url.pathname === "/jwks") {
        jwksRequests++;
        return Response.json({
          keys: [{ ...publicKey.export({ format: "jwk" }), kid: "q01", alg: "RS256", use: "sig" }],
        });
      }
      if (url.pathname === "/authorize") {
        const params = url.searchParams;
        assert.equal(params.get("client_id"), "q01-client");
        assert.equal(params.get("redirect_uri"), `${origin}/auth/oidc/callback`);
        assert.equal(params.get("response_type"), "code");
        assert.equal(params.get("code_challenge_method"), "S256");
        for (const name of ["nonce", "state", "code_challenge"]) assert.ok(params.get(name));
        const code = crypto.randomUUID();
        codes.set(code, new URLSearchParams(params));
        return Response.redirect(
          `${origin}/auth/oidc/callback?${new URLSearchParams({ code, state: params.get("state") ?? "" })}`,
          302,
        );
      }
      if (url.pathname === "/token") {
        tokenRequests++;
        assert.equal(request.method, "POST");
        assert.ok(
          request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded"),
        );
        const body = new URLSearchParams(await request.text());
        assert.equal(body.get("grant_type"), "authorization_code");
        assert.equal(body.get("client_id"), "q01-client");
        assert.equal(body.get("client_secret"), "q01-fixture-secret");
        assert.equal(body.get("redirect_uri"), `${origin}/auth/oidc/callback`);
        const code = body.get("code") ?? "";
        const params = codes.get(code);
        if (!params) return Response.json({ error: "invalid_grant" }, { status: 400 });
        codes.delete(code);
        assert.equal(
          createHash("sha256")
            .update(body.get("code_verifier") ?? "")
            .digest("base64url"),
          params.get("code_challenge"),
        );
        if (mode === "outage") return Response.json({ error: "unavailable" }, { status: 503 });
        const now = Math.floor(Date.now() / 1000);
        const payload: Record<string, unknown> = {
          iss: issuer,
          aud: "q01-client",
          sub: "owned-provider-user",
          iat: now,
          exp: now + 120,
          nonce: params.get("nonce"),
          email,
          email_verified: true,
          name: "Q01 Provider User",
          at_hash: createHash("sha256")
            .update("owned-access-token")
            .digest()
            .subarray(0, 16)
            .toString("base64url"),
        };
        if (mode === "nonce") payload.nonce = "wrong";
        if (mode === "issuer") payload.iss = `${issuer}/other`;
        if (mode === "audience") payload.aud = "other-client";
        if (mode === "expired") payload.exp = now - 3600;
        if (mode === "unverified") payload.email_verified = false;
        if (mode === "access-hash") payload.at_hash = "wrong";
        const encoded = [{ alg: "RS256", typ: "JWT", kid: "q01" }, payload]
          .map((value) => Buffer.from(JSON.stringify(value)).toString("base64url"))
          .join(".");
        const signature = sign(
          "RSA-SHA256",
          Buffer.from(encoded),
          mode === "signature" ? wrongKey : privateKey,
        ).toString("base64url");
        return Response.json({
          access_token: "owned-access-token",
          token_type: "Bearer",
          id_token: `${encoded}.${signature}`,
        });
      }
      return new Response("Not found", { status: 404 });
    } catch (error) {
      protocolFailure = error;
      return new Response("Fixture protocol assertion failed", { status: 500 });
    }
  },
});
issuer = `http://127.0.0.1:${idp.port}`;
let stop: (() => Promise<void>) | undefined;
const cwd = process.cwd();
try {
  Object.assign(process.env, {
    DATABASE_URL: fixture.runtimeUrl,
    APP_DATABASE_URL: fixture.runtimeUrl,
    MIGRATION_DATABASE_URL: fixture.migrationUrl,
    APP_ENV: "local",
    APP_DEBUG: "false",
    APP_NAME: "Q01 OIDC",
    APP_KEY_PREFIX: prefix,
    APP_URL: "http://localhost:3000",
    FRONTEND_MODE: "server-htmx",
    TENANCY_DRIVER: engine === "postgres" ? "rls" : "column",
    AUTH_DEV_HEADERS: "false",
    SESSION_SECRET: "q01-oidc-fixture-session-secret-at-least-32",
    TOKEN_HASH_PEPPER: "q01-oidc-pepper",
    JWT_SECRET: "q01-oidc-fixture-jwt-secret-at-least-32",
    KMS_ENCRYPTION_KEY: Buffer.alloc(32, 17).toString("base64"),
    FEATURE_OAUTH: "true",
    FEATURE_SAML: "false",
    FEATURE_SCIM: "false",
    FEATURE_MFA: "true",
    FEATURE_REGISTRATION: "true",
    CACHE_DRIVER: "array",
    QUEUE_DRIVER: "sync",
    MAIL_DRIVER: "log",
    OAUTH_STATE_SECRET: "q01-oidc-fixture-state-secret-at-least-32",
    OIDC_ISSUER: issuer,
    OIDC_CLIENT_ID: "q01-client",
    OIDC_CLIENT_SECRET: "q01-fixture-secret",
  });
  delete process.env.OIDC_ALLOW_PRIVATE;
  delete process.env.STRATA_SCHEMA;
  process.chdir(fixture.app);
  const migration = Bun.spawn(
    [
      process.execPath,
      join(fixture.app, "node_modules/@getstrata/cli/cli.ts"),
      "migrate",
      "--seed",
    ],
    {
      cwd: fixture.app,
      env: {
        ...process.env,
        ...(engine === "mysql"
          ? { DATABASE_URL: fixture.migrationUrl, APP_DATABASE_URL: fixture.migrationUrl }
          : {}),
      },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 60000,
      killSignal: "SIGKILL",
    },
  );
  const [migrationCode, migrationOut, migrationErr] = await Promise.all([
    migration.exited,
    new Response(migration.stdout).text(),
    new Response(migration.stderr).text(),
  ]);
  assert.equal(migrationCode, 0, `${migrationOut}${migrationErr}`);
  // Administrative credentials belong to the isolated migration command only.
  for (const name of [
    "MIGRATION_DATABASE_URL",
    "MYSQL_OBSERVABILITY_ADMIN_URL",
    "MYSQL_URL",
    "RLS_TEST_DATABASE_URL",
    "POSTGRES_PASSWORD",
    "STRATA_APP_PASSWORD",
  ])
    delete process.env[name];
  const database = await import(join(fixture.app, "src/bootstrap/database.ts"));
  stop = () => database.closeDatabase();
  const { bootstrapApp, createAppServer } = await import(
    join(fixture.app, "src/bootstrap/createApp.ts")
  );
  const { routes, context } = await bootstrapApp({ migrate: false });
  const server = createAppServer(routes, 0, undefined, { hostname: "127.0.0.1" });
  stop = async () => {
    server.stop(true);
    try {
      await context.dispose();
    } finally {
      await database.closeDatabase();
    }
  };
  origin = server.url.origin;
  process.env.OIDC_REDIRECT_URI = `${origin}/auth/oidc/callback`;
  const request = (url: string, cookie = "") =>
    fetch(url, {
      redirect: "manual",
      headers: { cookie, accept: "text/html" },
      signal: AbortSignal.timeout(10000),
    });
  async function handshake() {
    const start = await request(`${origin}/auth/oidc`);
    assert.equal(start.status, 302);
    const cookie = mergeCookies(start);
    const sealed = start.headers.getSetCookie().find((value) => value.startsWith("oidc_pkce="));
    assert.ok(sealed?.includes("HttpOnly"));
    const authorize = await request(start.headers.get("location") ?? "");
    assert.equal(authorize.status, 302);
    return { cookie, callback: authorize.headers.get("location") ?? "" };
  }
  async function denied(response: Response, status: number, message: string) {
    assert.equal(response.status, status);
    assert.ok(response.headers.get("content-type")?.includes("application/json"));
    assert.deepEqual(await response.json(), { error: message });
    assert.ok(
      response.headers
        .getSetCookie()
        .some((value) => value.startsWith("oidc_pkce=") && value.includes("Max-Age=0")),
    );
    assert.ok(
      !response.headers.getSetCookie().some((value) => value.startsWith(`${prefix}_session=`)),
    );
  }
  async function login(expectedEmail: string) {
    const issued = await handshake();
    const result = await request(issued.callback, issued.cookie);
    assert.equal(result.status, 302, await result.text());
    assert.equal(result.headers.get("location"), "/");
    const cookie = mergeCookies(result, issued.cookie);
    assert.ok(
      result.headers
        .getSetCookie()
        .some((value) => value.startsWith("oidc_pkce=") && value.includes("Max-Age=0")),
    );
    const me = await request(`${origin}/api/v1/auth/me`, cookie);
    assert.equal(me.status, 200);
    const user = await me.json();
    assert.ok(user !== null && typeof user === "object" && !Array.isArray(user));
    assert.ok("email" in user && "role" in user && "id" in user);
    assert.equal(user.email, expectedEmail);
    assert.equal(user.role, "member");
    const replay = await request(issued.callback, issued.cookie);
    await denied(replay, 400, "Invalid OIDC response.");
    return user.id;
  }
  const demoId = await login("demo@example.com");
  email = "demo@example.com";
  assert.equal(
    await login("demo@example.com"),
    demoId,
    "Case normalization must reuse the same account.",
  );
  email = "New.Q01@Example.Test";
  const newId = await login("new.q01@example.test");
  assert.notEqual(newId, demoId);
  assert.equal(await login("new.q01@example.test"), newId);
  // Ordinary fixture mutations use the generated model and installed tenant API.
  const { User } = await import(join(fixture.app, "src/models/User.ts"));
  const { runWithTenantDatabase } = await import(
    fixture.resolve("@getstrata/core/tenant/tenantDatabaseScope")
  );
  const tenant = { id: 1, slug: "default" };
  await runWithTenantDatabase(tenant, async () => {
    assert.equal(await User.where({ email: "new.q01@example.test" }).count(), 1);
    const user = await User.find(demoId);
    assert.ok(user);
    await user.update({ mfa_enabled: true });
  });
  email = "DEMO@EXAMPLE.COM";
  const mfaIssued = await handshake();
  const mfa = await request(mfaIssued.callback, mfaIssued.cookie);
  assert.equal(mfa.status, 302);
  assert.equal(mfa.headers.get("location"), "/login/mfa");
  assert.ok(mfa.headers.getSetCookie().some((value) => value.startsWith("strata_mfa_pending=")));
  const pending = await request(`${origin}/api/v1/auth/me`, mergeCookies(mfa, mfaIssued.cookie));
  assert.equal(pending.status, 401, "Pending MFA must not grant a session.");
  await pending.text();
  await runWithTenantDatabase(tenant, async () => {
    const user = await User.find(demoId);
    assert.ok(user);
    await user.update({ mfa_enabled: false, is_active: false });
  });
  const inactiveIssued = await handshake();
  const inactive = await request(inactiveIssued.callback, inactiveIssued.cookie);
  assert.equal(inactive.status, 403);
  assert.deepEqual(await inactive.json(), { error: "Account unavailable." });
  for (const failure of [
    "nonce",
    "issuer",
    "audience",
    "expired",
    "unverified",
    "access-hash",
    "signature",
    "outage",
  ]) {
    mode = failure;
    const issued = await handshake();
    await denied(await request(issued.callback, issued.cookie), 400, "Invalid OIDC response.");
  }
  mode = "valid";
  const issued = await handshake();
  const before = tokenRequests;
  await denied(await request(issued.callback), 403, "Invalid OIDC state.");
  const changed = new URL(issued.callback);
  changed.searchParams.set("state", "not-the-issued-state");
  await denied(await request(changed.href, issued.cookie), 403, "Invalid OIDC state.");
  assert.equal(tokenRequests, before, "Rejected handshake must not reach the token endpoint.");
  process.env.FEATURE_REGISTRATION = "false";
  email = "not-provisioned@example.test";
  const unprovisioned = await handshake();
  const refused = await request(unprovisioned.callback, unprovisioned.cookie);
  assert.equal(refused.status, 403);
  assert.deepEqual(await refused.json(), { error: "OIDC user is not provisioned." });
  for (const flag of ["false", "1", "TRUE"]) {
    process.env.FEATURE_OAUTH = flag;
    assert.equal((await request(`${origin}/auth/oidc`)).status, 404);
    assert.equal((await request(issued.callback, issued.cookie)).status, 404);
  }
  assert.equal(tokenRequests, 19);
  assert.ok(jwksRequests > 0);
  if (protocolFailure) throw protocolFailure;
  console.log(
    `Packed ${engine} OIDC passed: real discovery/authorize/token/JWKS, PKCE, persisted cookie login, normalized lookup/JIT, invalid claims, replay, state and feature gates.`,
  );
} finally {
  try {
    await stop?.();
  } finally {
    idp.stop(true);
    process.chdir(cwd);
    await fixture.close();
  }
}
