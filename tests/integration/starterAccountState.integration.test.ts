import { afterEach, expect, test } from "bun:test";
import { createHash, createSign, generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetDiscoverModulesForTests } from "@getstrata/bootstrap/discoverModules";
import { signJwt } from "@getstrata/core/auth/jwt";
import { oidcAccessTokenHash } from "@getstrata/core/auth/oauth/oidcIdToken";
import { hashPassword } from "@getstrata/core/auth/password";
import { protectMfaSecret } from "@getstrata/core/crypto/mfaSecret";
import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { resetBoundDatabaseConnection } from "@getstrata/core/database/boundConnection";
import { resetDefaultDatabasePoolForTests } from "@getstrata/core/database/defaultConnection";
import { resetSqlDialect } from "@getstrata/core/database/dialect";
import { defineTable } from "@getstrata/core/database/table";

import { generateTotp } from "@getstrata/core/security/totp";
import { runWithMigrationBypass } from "@getstrata/core/tenant/databaseTenantContext";
import { SQL } from "bun";
import {
  generateProject,
  resolveOverlayRoot,
  resolveTemplateRoot,
} from "../../packages/strata-starter/src/generate.ts";
import {
  layersFromFlags,
  parseCreateStrataArgs,
} from "../../packages/strata-starter/src/parseArgs.ts";
import { jsonCsrfHeaders, mergeCookies } from "../helpers/jsonCsrf";
import { installGeneratedAppDependencies, repoRoot } from "../unit/cli/helpers";

const original = { ...process.env };
const adminSource = process.env.MIGRATION_DATABASE_URL;
const runtimeSource = process.env.RLS_TEST_DATABASE_URL ?? process.env.APP_DATABASE_URL;
afterEach(() => {
  process.chdir(repoRoot);
  for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
  Object.assign(process.env, original);
  resetSqlDialect();
  resetBoundDatabaseConnection();
  resetDefaultDatabasePoolForTests();
  resetDiscoverModulesForTests();
});

async function withApp(
  driver: "sqlite" | "postgres",
  verify: (app: string, admin?: SQL) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), "strata-account-state-"));
  const name = `account_state_${crypto.randomUUID().replaceAll("-", "")}`;
  let control: SQL | undefined, admin: SQL | undefined;
  let created = false;
  try {
    const flags = parseCreateStrataArgs([
      "app",
      "--frontend=hybrid",
      `--database=${driver}`,
      `--tenancy=${driver === "postgres" ? "rls" : "column"}`,
      "--scim",
      "--oidc",
      "--auth=cookie-token-jwt",
      "--mfa",
      "--email-verification",
      "--yes",
    ]);
    const app = join(root, "app");
    generateProject({
      projectName: "app",
      targetDir: app,
      layers: layersFromFlags(flags),
      templateRoot: resolveTemplateRoot(),
      overlayRoot: resolveOverlayRoot(),
    });
    const pkg = JSON.parse(await readFile(join(app, "package.json"), "utf8"));
    for (const part of ["core", "bootstrap", "cli"])
      pkg.dependencies[`@getstrata/${part}`] = `file:${join(repoRoot, `packages/strata-${part}`)}`;
    await writeFile(join(app, "package.json"), JSON.stringify(pkg));
    installGeneratedAppDependencies(app);
    process.chdir(app);
    Object.assign(process.env, {
      APP_ENV: "local",
      FRONTEND_MODE: "hybrid",
      AUTH_DEV_HEADERS: "false",
      TENANCY_DRIVER: driver === "postgres" ? "rls" : "column",
      FEATURE_SCIM: "true",
      SCIM_TENANT_TOKENS: "1:fixture-one,2:fixture-two",
      SCIM_BEARER_TOKEN: "",
      REDIS_URL: "",
      FEATURE_EMAIL_VERIFICATION: "false",
      SESSION_SECRET: "dev-mfa-enrollment-secret-at-least-32-characters",
      CACHE_DRIVER: "array",
      QUEUE_DRIVER: "sync",
      MAIL_DRIVER: "log",
      KMS_ENCRYPTION_KEY: "a".repeat(64),
      FEATURE_MFA: "true",
      FEATURE_API_TOKENS: "true",
      FEATURE_REGISTRATION: "true",
    });
    delete process.env.KMS_ENCRYPTION_KEYRING;
    delete process.env.KMS_ENCRYPTION_ACTIVE_KEY;
    if (driver === "postgres") {
      if (!adminSource || !runtimeSource) throw new Error("Dedicated Postgres roles required");
      control = new SQL(adminSource);
      await control.unsafe(`CREATE DATABASE ${name}`);
      created = true;
      const a = new URL(adminSource),
        r = new URL(runtimeSource);
      a.pathname = r.pathname = `/${name}`;
      process.env.DATABASE_URL = r.href;
      process.env.APP_DATABASE_URL = r.href;
      process.env.MIGRATION_DATABASE_URL = a.href;
      admin = new SQL(a.href);
    } else {
      process.env.DATABASE_URL = "sqlite:./storage/app.sqlite";
      delete process.env.APP_DATABASE_URL;
      delete process.env.MIGRATION_DATABASE_URL;
    }
    resetDiscoverModulesForTests();
    await verify(app, admin);
  } finally {
    process.chdir(repoRoot);
    await admin?.close();
    if (created) await control?.unsafe(`DROP DATABASE ${name} WITH (FORCE)`);
    await control?.close();
    await rm(root, { recursive: true, force: true });
  }
}

async function responseObject(response: Response): Promise<Record<string, unknown>> {
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new Error("Expected response object");
  return body as Record<string, unknown>;
}
async function responseToken(response: Response): Promise<string> {
  const token = (await responseObject(response)).token;
  if (typeof token !== "string" || !token) throw new Error("Expected credential");
  return token;
}

for (const driver of ["sqlite", "postgres"] as const) {
  test(
    `generated ${driver} suspension fences every credential, replay and concurrent issuance without losing tenant isolation`,
    async () =>
      withApp(driver, async (app, admin) => {
        const { bootstrapApp, createAppServer } = await import(
          join(app, "src/bootstrap/createApp.ts")
        );
        const { closeDatabase, getSql } = await import(join(app, "src/bootstrap/database.ts"));
        const { User } = await import(join(app, "src/models/User.ts"));
        const { runWithLockedAuthUser } = await import(join(app, "src/bootstrap/authDirectory.ts"));
        const boot = await bootstrapApp();
        const server = createAppServer(boot.routes, 0),
          origin = `http://127.0.0.1:${server.port}`;
        process.env.APP_URL = origin;
        process.env.JWT_SECRET = "fixture-account-state-jwt-secret-at-least-32-characters";
        process.env.JWT_TTL_SECONDS = "3600";
        process.env.API_TOKEN_DEFAULT_EXPIRY_DAYS = "1";
        const password = "Initial!Password123",
          secret = "JBSWY3DPEHPK3PXP";
        const tenants = new BaseRepository(
          defineTable<{ id: number; slug: string }, "id">({
            name: "tenant",
            primaryKey: "id",
            columns: ["id", "slug"],
          }),
        );
        let idp: ReturnType<typeof Bun.serve> | undefined;
        let release = () => {};
        let blocked: Promise<unknown> | undefined;
        const concurrent: Promise<unknown>[] = [];
        try {
          if (driver === "postgres") {
            const [role] = await getSql().unsafe(
              "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
            );
            expect(role.rolsuper).toBe(false);
            expect(role.rolbypassrls).toBe(false);
            const [table] = await getSql().unsafe(
              "SELECT relforcerowsecurity FROM pg_class WHERE relname='users'",
            );
            expect(table.relforcerowsecurity).toBe(true);
          }
          const { target, neighbor } = await runWithMigrationBypass(async () => {
            await tenants.create({ slug: "one" });
            await tenants.create({ slug: "two" });
            const target = await User.create({
              name: "Original",
              email: "target@example.test",
              password: await hashPassword(password),
              is_admin: false,
              tenant_id: 2,
              mfa_enabled: true,
              mfa_secret: protectMfaSecret(secret),
            });
            const neighbor = await User.create({
              name: "Neighbor",
              email: "neighbor@example.test",
              password: await hashPassword(password),
              is_admin: false,
              tenant_id: 1,
            });
            return { target, neighbor };
          });
          const id = Number(target.get("id"));
          const csrf = await jsonCsrfHeaders(origin);
          async function post(path: string, body: object | URLSearchParams, cookie = csrf.cookie) {
            const form = body instanceof URLSearchParams;
            return fetch(`${origin}${path}`, {
              method: "POST",
              redirect: "manual",
              headers: {
                ...csrf.headers,
                cookie,
                "content-type": form ? "application/x-www-form-urlencoded" : "application/json",
                accept: form ? "text/html" : "application/json",
              },
              body: form ? body : JSON.stringify(body),
            });
          }
          async function authStatus(cookie?: string, bearer?: string, basic = false) {
            const response = await fetch(`${origin}/api/user`, {
              headers: {
                ...(cookie ? { cookie } : {}),
                ...(bearer
                  ? { authorization: `Bearer ${bearer}` }
                  : basic
                    ? {
                        authorization: `Basic ${Buffer.from(`target@example.test:${password}`).toString("base64")}`,
                        "x-mfa-code": generateTotp(secret),
                      }
                    : {}),
              },
            });
            await response.text();
            return response.status;
          }
          async function credentials() {
            const response = await post("/api/v1/auth/login", {
              email: "target@example.test",
              password,
              mfa_code: generateTotp(secret),
            });
            expect(response.status).toBe(200);
            const token = await responseToken(response);
            const cookie = mergeCookies(response, csrf.cookie);
            const jwtResponse = await post("/api/auth/token", {
              email: "target@example.test",
              password,
              mfa_code: generateTotp(secret),
            });
            expect(jwtResponse.status).toBe(200);
            const jwt = await responseToken(jwtResponse);
            return { cookie, token, jwt };
          }
          async function statuses(proofs: Awaited<ReturnType<typeof credentials>>) {
            return [
              await authStatus(proofs.cookie),
              await authStatus(undefined, proofs.token),
              await authStatus(undefined, proofs.jwt),
            ];
          }
          async function scim(active: boolean, token = "fixture-two", extra: unknown[] = []) {
            const response = await fetch(`${origin}/scim/v2/Users/${id}`, {
              method: "PATCH",
              headers: {
                authorization: `Bearer ${token}`,
                "content-type": "application/scim+json",
              },
              body: JSON.stringify({
                schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
                Operations: [{ op: "replace", path: "active", value: active }, ...extra],
              }),
            });
            const body = await responseObject(response);
            return { status: response.status, body };
          }
          const read = () => runWithMigrationBypass(() => User.find(id));
          const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
          const challenges = new Map<string, string>();
          idp = Bun.serve({
            port: 0,
            async fetch(request) {
              const url = new URL(request.url),
                issuer = idp?.url.origin;
              if (url.pathname === "/.well-known/openid-configuration")
                return Response.json({
                  issuer,
                  authorization_endpoint: `${issuer}/authorize`,
                  token_endpoint: `${issuer}/token`,
                  jwks_uri: `${issuer}/jwks`,
                });
              if (url.pathname === "/jwks")
                return Response.json({
                  keys: [
                    {
                      ...publicKey.export({ format: "jwk" }),
                      kid: "fixture",
                      alg: "RS256",
                      use: "sig",
                    },
                  ],
                });
              if (url.pathname !== "/token") return new Response("missing", { status: 404 });
              const form = await request.formData(),
                code = String(form.get("code"));
              const verifier = createHash("sha256")
                .update(String(form.get("code_verifier")))
                .digest("base64url");
              if (challenges.get(code) !== verifier)
                return new Response("PKCE failed", { status: 400 });
              challenges.delete(code);
              const now = Math.floor(Date.now() / 1000);
              const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "fixture" })).toString(
                "base64url",
              );
              const payload = Buffer.from(
                JSON.stringify({
                  iss: issuer,
                  aud: "fixture",
                  sub: "fixture-target",
                  email: "TARGET@EXAMPLE.TEST",
                  email_verified: true,
                  name: "Target",
                  nonce: code,
                  at_hash: oidcAccessTokenHash("fixture-access"),
                  iat: now,
                  exp: now + 300,
                }),
              ).toString("base64url");
              const input = `${header}.${payload}`;
              const signature = createSign("RSA-SHA256")
                .update(input)
                .sign(privateKey, "base64url");
              return Response.json({
                access_token: "fixture-access",
                id_token: `${input}.${signature}`,
              });
            },
          });
          process.env.FEATURE_OAUTH = "true";
          process.env.OIDC_ISSUER = idp.url.origin;
          process.env.OIDC_CLIENT_ID = "fixture";
          process.env.OIDC_CLIENT_SECRET = "fixture-secret";
          process.env.OIDC_REDIRECT_URI = `${origin}/auth/oidc/callback`;
          async function sso() {
            const begin = await fetch(`${origin}/auth/oidc`, { redirect: "manual" });
            expect(begin.status).toBe(302);
            const location = new URL(begin.headers.get("location") ?? "");
            const nonce = location.searchParams.get("nonce") ?? "";
            challenges.set(nonce, location.searchParams.get("code_challenge") ?? "");
            const cookie = mergeCookies(begin);
            await begin.text();
            return fetch(
              `${origin}/auth/oidc/callback?code=${nonce}&state=${encodeURIComponent(location.searchParams.get("state") ?? "")}`,
              { redirect: "manual", headers: { cookie } },
            );
          }
          const initialSso = await sso();
          expect(initialSso.status).toBe(302);
          expect(initialSso.headers.get("location")).toBe("/login/mfa");
          const pendingSso = mergeCookies(initialSso, csrf.cookie);
          await initialSso.text();

          const initial = await credentials();
          expect(await statuses(initial)).toEqual([200, 200, 200]);
          expect(await authStatus(undefined, undefined, true)).toBe(200);
          const pendingResponse = await post(
            "/login",
            new URLSearchParams({ email: "target@example.test", password, _token: csrf.token }),
          );
          expect(pendingResponse.status).toBe(302);
          expect(pendingResponse.headers.get("location")).toBe("/login/mfa");
          const pending = mergeCookies(pendingResponse, csrf.cookie);
          await pendingResponse.text();
          const confirmation = await post(
            "/confirm-password",
            new URLSearchParams({ password, _token: csrf.token }),
            initial.cookie,
          );
          expect(confirmation.status).toBe(302);
          const confirmed = mergeCookies(confirmation, initial.cookie);
          await confirmation.text();
          expect((await scim(false, "fixture-one")).status).toBe(404);
          expect((await read()).get("auth_version")).toBe(0);
          // No partial mutation when a later PATCH operation is invalid.
          expect(
            (await scim(false, "fixture-two", [{ op: "remove", path: "displayName" }])).status,
          ).toBe(400);
          expect((await read()).get("auth_version")).toBe(0);
          expect(await statuses(initial)).toEqual([200, 200, 200]);
          // Fail credential deletion after the status/epoch writes: every effect must roll back.
          if (admin) {
            await admin.unsafe(
              "CREATE FUNCTION reject_account_session_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected credential delete failure'; END $$",
            );
            await admin.unsafe(
              `CREATE TRIGGER reject_account_session_delete BEFORE DELETE ON sessions FOR EACH ROW WHEN (OLD.user_id=${id}) EXECUTE FUNCTION reject_account_session_delete()`,
            );
          } else
            await getSql().unsafe(
              `CREATE TRIGGER reject_account_session_delete BEFORE DELETE ON sessions WHEN OLD.user_id=${id} BEGIN SELECT RAISE(ABORT,'injected credential delete failure'); END`,
            );
          try {
            expect((await scim(false)).status).toBe(driver === "sqlite" ? 400 : 500);
          } finally {
            if (admin) {
              await admin.unsafe("DROP TRIGGER reject_account_session_delete ON sessions");
              await admin.unsafe("DROP FUNCTION reject_account_session_delete()");
            } else await getSql().unsafe("DROP TRIGGER reject_account_session_delete");
          }
          expect((await read()).get("auth_version")).toBe(0);
          expect(await statuses(initial)).toEqual([200, 200, 200]);
          let reject = true;
          User.observe({
            updated(model: { get(key: string): unknown }) {
              if (reject && model.get("id") === id)
                throw new Error("injected account-state observer failure");
            },
          });
          try {
            expect((await scim(false)).status).toBe(500);
          } finally {
            reject = false;
          }
          expect((await read()).get("auth_version")).toBe(0);
          expect(await statuses(initial)).toEqual([200, 200, 200]);
          expect((await scim(false)).body.active).toBe(false);
          expect((await read()).get("auth_version")).toBe(1);
          expect(await statuses(initial)).toEqual([401, 401, 401]);
          const disabledSso = await sso();
          expect(disabledSso.status).toBe(403);
          expect(disabledSso.headers.get("content-type")).toContain("application/json");
          await disabledSso.text();
          expect(await authStatus(undefined, undefined, true)).toBe(401);
          expect(
            (
              await post("/api/v1/auth/login", {
                email: "target@example.test",
                password,
                mfa_code: generateTotp(secret),
              })
            ).status,
          ).toBe(422);
          expect(
            (
              await post("/api/auth/token", {
                email: "target@example.test",
                password,
                mfa_code: generateTotp(secret),
              })
            ).status,
          ).toBe(422);
          expect((await scim(false)).status).toBe(200);
          expect((await read()).get("auth_version")).toBe(1);
          expect((await scim(true)).body.active).toBe(true);
          expect((await read()).get("auth_version")).toBe(2);
          expect(await statuses(initial)).toEqual([401, 401, 401]);
          for (const oldPending of [pending, pendingSso]) {
            const staleMfa = await post(
              "/login/mfa",
              new URLSearchParams({ code: generateTotp(secret), _token: csrf.token }),
              oldPending,
            );
            expect(staleMfa.status).toBe(302);
            expect(staleMfa.headers.get("location")).toBe("/login");
            await staleMfa.text();
          }
          const fresh = await credentials();
          expect(await statuses(fresh)).toEqual([200, 200, 200]);
          // A pre-suspension password-confirmation proof cannot authorize a new session.
          const oldConfirm = confirmed
            .split(";")
            .filter((value) => value.includes("password_confirmed"));
          const staleConfirm = `${fresh.cookie};${oldConfirm.join(";")}`;
          const mfaSetup = await post(
            "/account/mfa",
            new URLSearchParams({ secret, code: generateTotp(secret), _token: csrf.token }),
            staleConfirm,
          );
          expect(mfaSetup.status).toBe(302);
          expect(mfaSetup.headers.get("location")).toContain("/confirm-password");
          await mfaSetup.text();
          // Missing authVersion never upgrades an old stateless proof after adoption.
          expect(await authStatus(undefined, signJwt({ sub: id, role: "member" }))).toBe(401);
          // Hold the same official account lock used by issuance and SCIM. The epoch
          // changes before the queued login is admitted, so it must use fresh state.
          let entered = () => {};
          const ready = new Promise<void>((resolve) => {
            entered = resolve;
          });
          const held = new Promise<void>((resolve) => {
            release = resolve;
          });
          blocked = runWithLockedAuthUser(id, async () => {
            entered();
            await held;
          });
          await ready;
          let completed = false;
          const disable = scim(false).then((result) => {
            completed = true;
            return result;
          });
          concurrent.push(disable);
          if (admin) {
            const deadline = Date.now() + 5000;
            let waiting = false;
            while (Date.now() < deadline) {
              const [row] = await admin.unsafe(
                "SELECT COUNT(*) AS waiting FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FOR UPDATE%'",
              );
              waiting = Number(row?.waiting) > 0;
              if (waiting || completed) break;
              await new Promise<void>((resolve) => setTimeout(resolve, 10));
            }
            expect(waiting).toBe(true);
          } else await new Promise<void>((resolve) => setTimeout(resolve, 30));
          expect(completed).toBe(false);
          const racingLogin = post("/api/v1/auth/login", {
            email: "target@example.test",
            password,
            mfa_code: generateTotp(secret),
          });
          concurrent.push(racingLogin);
          release();
          await blocked;
          blocked = undefined;
          expect((await disable).status).toBe(200);
          const raced = await racingLogin;
          expect([200, 422]).toContain(raced.status);
          const racedToken = raced.status === 200 ? await responseToken(raced) : undefined;
          if (racedToken) expect(await authStatus(undefined, racedToken)).toBe(401);
          await raced.text().catch(() => {});
          expect((await read()).get("auth_version")).toBe(3);
          expect((await scim(true)).status).toBe(200);
          expect(await statuses(fresh)).toEqual([401, 401, 401]);
          if (racedToken) expect(await authStatus(undefined, racedToken)).toBe(401);
          await runWithMigrationBypass(async () => {
            expect((await User.find(neighbor.get("id"))).get("name")).toBe("Neighbor");
          });
          const created = await fetch(`${origin}/scim/v2/Users`, {
            method: "POST",
            headers: {
              authorization: "Bearer fixture-two",
              "content-type": "application/scim+json",
            },
            body: JSON.stringify({
              userName: "inactive@example.test",
              displayName: "Inactive",
              active: false,
            }),
          });
          expect(created.status).toBe(201);
          expect(
            created.headers.getSetCookie().some((value) => value.startsWith("strata_session=")),
          ).toBe(false);
          const inactiveBody = await responseObject(created);
          expect(inactiveBody.active).toBe(false);
          expect(inactiveBody.token).toBeUndefined();
          expect(
            (await Promise.all([scim(false), scim(false)])).map((result) => result.status),
          ).toEqual([200, 200]);
          expect((await read()).get("auth_version")).toBe(5);
          expect(
            (await Promise.all([scim(true), scim(true)])).map((result) => result.status),
          ).toEqual([200, 200]);
          expect((await read()).get("auth_version")).toBe(6);
          await runWithMigrationBypass(async () => {
            const inactive = await User.where({ email: "inactive@example.test" }).first();
            expect(inactive.get("is_active") === false || inactive.get("is_active") === 0).toBe(
              true,
            );
            expect(inactive.get("auth_version")).toBe(0);
          });
        } finally {
          release();
          await blocked?.catch(() => {});
          await Promise.allSettled(concurrent);
          idp?.stop(true);
          server.stop(true);
          await boot.context.dispose();
          await closeDatabase();
        }
      }),
    60000,
  );
}
