/** Installed-package SAML ACS + SQL replay acceptance; signed IdP fixtures are independent. */
import assert from "node:assert/strict";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { createGeneratedSecurityApp } from "../tests/helpers/generatedSecurityApp.ts";
import { mergeCookies } from "../tests/helpers/jsonCsrf.ts";
import { createSignedSamlResponse } from "../tests/helpers/samlFixture.ts";

const engine = process.argv[2];
assert.ok(engine === "postgres" || engine === "sqlite" || engine === "mysql");
const material = await createSignedSamlResponse();
const fixture = await createGeneratedSecurityApp(engine);
const prefix = `saml_${crypto.randomUUID().replaceAll("-", "")}`;
const audience = "https://q01-sp.example.test/metadata";
const issuer = "https://idp.example.test/metadata";
const cwd = process.cwd();
let stop: (() => Promise<void>) | undefined;
try {
  Object.assign(process.env, {
    DATABASE_URL: fixture.runtimeUrl,
    APP_DATABASE_URL: fixture.runtimeUrl,
    MIGRATION_DATABASE_URL: fixture.migrationUrl,
    APP_ENV: "local",
    APP_DEBUG: "false",
    APP_NAME: "Q01 SAML",
    APP_KEY_PREFIX: prefix,
    APP_URL: "http://localhost:3000",
    FRONTEND_MODE: "server-htmx",
    TENANCY_DRIVER: engine === "postgres" ? "rls" : "column",
    AUTH_DEV_HEADERS: "false",
    SESSION_SECRET: "q01-saml-fixture-session-secret-at-least-32",
    TOKEN_HASH_PEPPER: "q01-saml-pepper",
    JWT_SECRET: "q01-saml-fixture-jwt-secret-at-least-32",
    KMS_ENCRYPTION_KEY: Buffer.alloc(32, 17).toString("base64"),
    FEATURE_OAUTH: "false",
    FEATURE_SAML: "true",
    FEATURE_SCIM: "false",
    FEATURE_MFA: "true",
    FEATURE_REGISTRATION: "true",
    CACHE_DRIVER: "array",
    QUEUE_DRIVER: "sync",
    MAIL_DRIVER: "log",
    OAUTH_STATE_SECRET: "q01-saml-fixture-state-secret-at-least-32",
    SAML_IDP_SSO_URL: "https://idp.example.test/sso",
    SAML_IDP_CERT: material.cert,
    SAML_SP_ENTITY_ID: audience,
    SAML_IDP_ISSUER: issuer,
    SAML_WANT_RESPONSE_SIGNED: "true",
  });
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
  const [code, out, err] = await Promise.all([
    migration.exited,
    new Response(migration.stdout).text(),
    new Response(migration.stderr).text(),
  ]);
  assert.equal(code, 0, `${out}${err}`);
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
  const server = createAppServer(routes, 0);
  stop = async () => {
    server.stop(true);
    try {
      await context.dispose();
    } finally {
      await database.closeDatabase();
    }
  };
  const origin = `http://127.0.0.1:${server.port}`;
  const destination = `${origin}/auth/saml/acs`;
  process.env.SAML_ACS_URL = destination;
  async function relay() {
    const start = await fetch(`${origin}/auth/saml`, {
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(start.status, 302);
    const target = new URL(start.headers.get("location") ?? "");
    assert.equal(target.origin + target.pathname, process.env.SAML_IDP_SSO_URL);
    const request = target.searchParams.get("SAMLRequest");
    assert.ok(request);
    const xml = inflateRawSync(Buffer.from(request, "base64")).toString();
    assert.ok(xml.includes(audience));
    assert.ok(xml.includes(destination));
    const state = target.searchParams.get("RelayState");
    assert.ok(state);
    return state;
  }
  const assertion = (options: Parameters<typeof createSignedSamlResponse>[0] = {}) =>
    createSignedSamlResponse({
      audience,
      destination,
      issuer,
      cert: material.cert,
      privateKey: material.privateKey,
      ...options,
    });
  const post = (responseB64: string, state: string) =>
    fetch(destination, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
      // IdP-shaped cross-site form POST deliberately has no app cookies/CSRF token.
      headers: {
        origin: "https://idp.example.test",
        accept: "text/html",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ SAMLResponse: responseB64, RelayState: state }),
    });
  async function denied(response: Response, status: number, message: string) {
    assert.equal(response.status, status);
    assert.ok(response.headers.get("content-type")?.includes("application/json"));
    assert.deepEqual(await response.json(), { error: message });
    assert.ok(
      !response.headers.getSetCookie().some((value) => value.startsWith(`${prefix}_session=`)),
    );
  }
  const assertionId = `q01_${crypto.randomUUID().replaceAll("-", "")}`;
  const signed = await assertion({ email: "DEMO@EXAMPLE.COM", assertionId });
  const state = await relay();
  const login = await post(signed.responseB64, state);
  if (login.status !== 302) {
    // Surface the underlying installed provider error only after the real route failed.
    const { createSamlServiceProvider } = await import(
      fixture.resolve("@getstrata/core/auth/saml/samlServiceProvider")
    );
    await createSamlServiceProvider().consumePost(signed.responseB64, state);
  }
  assert.equal(login.status, 302, await login.text());
  assert.equal(login.headers.get("location"), "/");
  const cookie = mergeCookies(login);
  const me = await fetch(`${origin}/api/v1/auth/me`, { headers: { cookie } });
  assert.equal(me.status, 200);
  const user = await me.json();
  assert.ok(user !== null && typeof user === "object" && "email" in user && "id" in user);
  assert.equal(user.email, "demo@example.com");
  // Prove the default store wrote SQL state; do not inject an in-memory replay implementation.
  const { BaseRepository } = await import(
    fixture.resolve("@getstrata/core/database/baseRepository")
  );
  const { defineTable } = await import(fixture.resolve("@getstrata/core/database/table"));
  const replay = new BaseRepository(
    defineTable({
      name: "auth_saml_assertions",
      primaryKey: "assertion_id",
      columns: ["assertion_id", "consumed_at"],
    }),
    database.getSql(),
  );
  assert.equal(await replay.query({ assertion_id: assertionId }).count(), 1);
  await denied(await post(signed.responseB64, await relay()), 400, "Invalid SAML response.");
  assert.equal(await replay.query({ assertion_id: assertionId }).count(), 1);
  await denied(
    await post((await assertion()).responseB64, "wrong-state"),
    403,
    "Invalid SAML state.",
  );
  for (const options of [
    { signed: false },
    { audience: "https://wrong.example.test" },
    { issuer: "https://wrong.example.test" },
    { destination: `${origin}/wrong-acs` },
    { recipient: `${origin}/wrong-recipient` },
  ])
    await denied(
      await post((await assertion(options)).responseB64, await relay()),
      400,
      "Invalid SAML response.",
    );
  const otherMaterial = await createSignedSamlResponse();
  await denied(
    await post(
      (await assertion({ cert: otherMaterial.cert, privateKey: otherMaterial.privateKey }))
        .responseB64,
      await relay(),
    ),
    400,
    "Invalid SAML response.",
  );
  const fresh = await assertion({ email: "New.Saml@Example.Test" });
  const created = await post(fresh.responseB64, await relay());
  assert.equal(created.status, 302);
  const newMe = await fetch(`${origin}/api/v1/auth/me`, {
    headers: { cookie: mergeCookies(created) },
  });
  assert.equal(newMe.status, 200);
  const newUser = await newMe.json();
  assert.ok(
    newUser !== null && typeof newUser === "object" && "email" in newUser && "id" in newUser,
  );
  assert.equal(newUser.email, "new.saml@example.test");
  assert.notEqual(newUser.id, user.id);
  const { User } = await import(join(fixture.app, "src/models/User.ts"));
  const { runWithTenantDatabase } = await import(
    fixture.resolve("@getstrata/core/tenant/tenantDatabaseScope")
  );
  await runWithTenantDatabase({ id: 1, slug: "default" }, async () => {
    assert.equal(await User.where({ email: "new.saml@example.test" }).count(), 1);
    const persisted = await User.find(user.id);
    assert.ok(persisted);
    await persisted.update({ mfa_enabled: true });
  });
  const mfa = await post(
    (await assertion({ email: "demo@example.com" })).responseB64,
    await relay(),
  );
  assert.equal(mfa.status, 302);
  assert.equal(mfa.headers.get("location"), "/login/mfa");
  assert.ok(mfa.headers.getSetCookie().some((value) => value.startsWith("strata_mfa_pending=")));
  const pending = await fetch(`${origin}/api/v1/auth/me`, {
    headers: { cookie: mergeCookies(mfa) },
  });
  assert.equal(pending.status, 401);
  await pending.text();
  for (const flag of ["false", "1", "TRUE"]) {
    process.env.FEATURE_SAML = flag;
    assert.equal((await fetch(`${origin}/auth/saml`, { redirect: "manual" })).status, 404);
    assert.equal((await post(signed.responseB64, state)).status, 404);
  }
  console.log(
    `Packed ${engine} SAML passed: signed cross-site ACS, persisted sessions/JIT/SQL replay, MFA, rejected response/state and feature gates.`,
  );
} finally {
  try {
    await stop?.();
  } finally {
    process.chdir(cwd);
    await fixture.close();
  }
}
