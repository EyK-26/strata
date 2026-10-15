import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetDiscoverModulesForTests } from "@getstrata/bootstrap/discoverModules";
import { hashPassword } from "@getstrata/core/auth/password";
import { revealMfaSecret } from "@getstrata/core/crypto/mfaSecret";
import { resetBoundDatabaseConnection } from "@getstrata/core/database/boundConnection";
import { resetDefaultDatabasePoolForTests } from "@getstrata/core/database/defaultConnection";
import { resetSqlDialect } from "@getstrata/core/database/dialect";
import { hashRecoveryCode } from "@getstrata/core/security/recoveryCodes";
import { generateTotp } from "@getstrata/core/security/totp";
import { runWithMigrationBypass } from "@getstrata/core/tenant/databaseTenantContext";
import { SQL } from "bun";
import {
  generateProject,
  resolveOverlayRoot,
  resolveTemplateRoot,
} from "../../../packages/strata-starter/src/generate.ts";
import {
  layersFromFlags,
  parseCreateStrataArgs,
} from "../../../packages/strata-starter/src/parseArgs.ts";
import { jsonCsrfHeaders, mergeCookies } from "../../helpers/jsonCsrf";
import { installGeneratedAppDependencies, repoRoot } from "./helpers";

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
  const root = await mkdtemp(join(tmpdir(), "strata-mfa-enroll-"));
  const name = `mfa_enroll_${crypto.randomUUID().replaceAll("-", "")}`;
  let control: SQL | undefined, admin: SQL | undefined;
  let created = false;
  try {
    const flags = parseCreateStrataArgs([
      "app",
      "--frontend=hybrid",
      `--database=${driver}`,
      `--tenancy=${driver === "postgres" ? "rls" : "none"}`,
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
      TENANCY_DRIVER: driver === "postgres" ? "rls" : "none",
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

function recoveryCodes(html: string): string[] {
  const section = html.split("<h2>Recovery codes</h2>")[1];
  expect(section).toBeDefined();
  const codes = [...(section ?? "").matchAll(/<li><code>([^<]+)<\/code><\/li>/g)].map(
    (x) => x[1] ?? "",
  );
  expect(codes.length).toBeGreaterThan(1);
  return codes;
}

async function client(origin: string, email: string, password: string, secret?: string) {
  const csrf = await jsonCsrfHeaders(origin);
  let cookie = csrf.cookie;
  async function request(
    path: string,
    body?: object | URLSearchParams,
    options: { destination?: string; signal?: AbortSignal } = {},
  ) {
    const form = body instanceof URLSearchParams;
    const response = await fetch(new URL(path, options.destination ?? origin), {
      method: body === undefined ? "GET" : "POST",
      redirect: "manual",
      signal: options.signal,
      headers: {
        origin,
        cookie,
        accept: form ? "text/html" : "application/json",
        "content-type": form ? "application/x-www-form-urlencoded" : "application/json",
        "x-csrf-token": csrf.token,
      },
      body: body === undefined ? undefined : form ? body : JSON.stringify(body),
    });
    cookie = mergeCookies(response, cookie);
    return response;
  }
  const response = await request("/api/v1/auth/login", {
    email,
    password,
    ...(secret ? { mfa_code: generateTotp(secret) } : {}),
  });
  expect(response.status).toBe(200);
  const token: unknown = await response.json();
  if (!token || typeof token !== "object" || !("token" in token) || typeof token.token !== "string")
    throw new Error("Missing API token");
  const jwtResponse = await request("/api/auth/token", {
    email,
    password,
    ...(secret ? { mfa_code: generateTotp(secret) } : {}),
  });
  expect(jwtResponse.status).toBe(200);
  const jwt: unknown = await jwtResponse.json();
  if (!jwt || typeof jwt !== "object" || !("token" in jwt) || typeof jwt.token !== "string")
    throw new Error("Missing JWT");
  const bearers = [token.token, jwt.token];
  const statuses = () =>
    Promise.all([
      request("/api/user").then((r) => r.status),
      ...bearers.map((bearer) =>
        fetch(`${origin}/api/user`, { headers: { authorization: `Bearer ${bearer}` } }).then(
          (r) => r.status,
        ),
      ),
    ]);
  const confirm = () =>
    request("/confirm-password", new URLSearchParams({ password, _token: csrf.token }));
  const setup = async () => {
    const page = await request("/account/mfa");
    expect(page.status).toBe(200);
    const secret = (await page.text()).match(/name="secret" value="([^"]+)"/)?.[1];
    if (!secret) throw new Error("Missing setup secret");
    return secret;
  };
  const submit = (secret: string, options?: { destination?: string; signal?: AbortSignal }) =>
    request(
      "/account/mfa",
      new URLSearchParams({ secret, code: generateTotp(secret), _token: csrf.token }),
      options,
    );
  return { request, statuses, confirm, setup, submit };
}

test(
  "generated SQLite enrollment rolls back every write boundary and recovers an unreceived success without replaying secrets",
  async () =>
    withApp("sqlite", async (app) => {
      const { bootstrapApp, createAppServer } = await import(
        join(app, "src/bootstrap/createApp.ts")
      );
      const { getSql, closeDatabase } = await import(join(app, "src/bootstrap/database.ts"));
      const { User } = await import(join(app, "src/models/User.ts"));
      const boot = await bootstrapApp();
      const server = createAppServer(boot.routes, 0);
      const origin = `http://127.0.0.1:${server.port}`;
      process.env.APP_URL = origin;
      let proxy: ReturnType<typeof Bun.serve> | undefined;
      let release = () => {};
      let attempt: Promise<Response> | undefined;
      let abort: AbortController | undefined;
      try {
        const password = "Initial!Password123";
        const user = await User.create({
          name: "Fixture",
          email: "mfa@example.test",
          password: await hashPassword(password),
          is_admin: false,
          email_verified_at: new Date().toISOString(),
        });
        const id = Number(user.get("id"));
        const neighbor = await User.create({
          name: "Neighbor",
          email: "neighbor@example.test",
          password: await hashPassword(password),
          is_admin: false,
          email_verified_at: new Date().toISOString(),
        });
        const actor = await client(origin, user.get("email"), password);
        const other = await client(origin, neighbor.get("email"), password);
        expect((await actor.confirm()).status).toBe(302);
        const secret = await actor.setup();
        const before = await User.find(id);
        for (const [table, operation, predicate] of [
          ["users", "UPDATE", `OLD.id=${id}`],
          ["sessions", "DELETE", `OLD.user_id=${id}`],
          ["api_tokens", "DELETE", `OLD.user_id=${id}`],
        ]) {
          await getSql().unsafe(
            `CREATE TRIGGER reject_enrollment BEFORE ${operation} ON ${table} WHEN ${predicate} BEGIN SELECT RAISE(ABORT,'injected enrollment failure'); END`,
          );
          try {
            expect((await actor.submit(secret)).status).toBe(400);
          } finally {
            await getSql().unsafe("DROP TRIGGER reject_enrollment");
          }
          const row = await User.find(id);
          for (const key of [
            "mfa_enabled",
            "mfa_secret",
            "mfa_recovery_codes",
            "session_valid_after",
          ])
            expect(row.get(key)).toEqual(before.get(key));
          expect(await actor.statuses()).toEqual([200, 200, 200]);
          expect(await other.statuses()).toEqual([200, 200, 200]);
        }
        let ready = () => {};
        const observed = new Promise<void>((r) => (ready = r)),
          gate = new Promise<void>((r) => (release = r));
        let forwards = 0,
          status = 0,
          hasCodes = false;
        proxy = Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          async fetch(request) {
            forwards++;
            const forwarded = new Request(new URL("/account/mfa", origin).href, {
              method: request.method,
              headers: request.headers,
              body: request.body,
            });
            forwarded.headers.set("host", new URL(origin).host);
            const response = await fetch(forwarded, { redirect: "manual" });
            status = response.status;
            hasCodes = (await response.text()).includes("<h2>Recovery codes</h2>");
            ready();
            await gate;
            return new Response(null, { status: 502 });
          },
        });
        abort = new AbortController();
        attempt = actor.submit(secret, {
          destination: `http://127.0.0.1:${proxy.port}`,
          signal: abort.signal,
        });
        const outcome = attempt.then(
          () => "unexpected-response",
          () => "aborted",
        );
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            observed,
            new Promise<never>((_resolve, reject) => {
              timeout = setTimeout(
                () => reject(new Error("Enrollment proxy did not observe backend completion")),
                7000,
              );
            }),
          ]);
        } finally {
          clearTimeout(timeout);
        }
        expect(status).toBe(200);
        expect(hasCodes).toBe(true);
        const committed = await User.find(id);
        expect(revealMfaSecret(committed.get("mfa_secret"))).toBe(secret);
        abort.abort();
        expect(await outcome).toBe("aborted");
        release();
        expect(forwards).toBe(1);
        expect(await actor.statuses()).toEqual([401, 401, 401]);
        expect((await actor.submit(secret)).status).toBe(302);
        expect((await User.find(id)).get("mfa_recovery_codes")).toBe(
          committed.get("mfa_recovery_codes"),
        );
        const fresh = await client(origin, user.get("email"), password, secret);
        expect((await fresh.confirm()).status).toBe(302);
        const replacementSecret = await fresh.setup();
        const replacement = await fresh.submit(replacementSecret);
        expect(replacement.status).toBe(200);
        const codes = recoveryCodes(await replacement.text());
        const final = await User.find(id);
        expect(revealMfaSecret(final.get("mfa_secret"))).toBe(replacementSecret);
        expect(JSON.parse(final.get("mfa_recovery_codes"))).toEqual(codes.map(hashRecoveryCode));
        expect(final.get("mfa_recovery_codes")).not.toBe(committed.get("mfa_recovery_codes"));
        expect(await fresh.statuses()).toEqual([401, 401, 401]);
        expect(await other.statuses()).toEqual([200, 200, 200]);
        const renewed = await client(origin, user.get("email"), password, replacementSecret);
        expect((await renewed.request("/account/mfa")).status).toBe(200);
        expect(await renewed.statuses()).toEqual([200, 200, 200]);
      } finally {
        release();
        abort?.abort();
        await attempt?.catch(() => {});
        await proxy?.stop(true);
        server.stop(true);
        await boot.context.dispose();
        await closeDatabase();
      }
    }),
  30000,
);

test.skipIf(!adminSource || !runtimeSource)(
  "generated Postgres RLS initial and replacement races reject stale writes and disclose only the winning recovery page",
  async () =>
    withApp("postgres", async (app, admin) => {
      if (!admin) throw new Error("Owned Postgres required");
      const { bootstrapApp, createAppServer } = await import(
        join(app, "src/bootstrap/createApp.ts")
      );
      const { getSql, closeDatabase } = await import(join(app, "src/bootstrap/database.ts"));
      const { User } = await import(join(app, "src/models/User.ts"));
      const boot = await bootstrapApp();
      const server = createAppServer(boot.routes, 0),
        origin = `http://127.0.0.1:${server.port}`;
      process.env.APP_URL = origin;
      let release = () => {};
      let held: Promise<unknown> | undefined;
      let attempts: Promise<Response[]> | undefined;
      try {
        const [role] = await getSql().unsafe(
          "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
        );
        expect(role.rolsuper).toBe(false);
        expect(role.rolbypassrls).toBe(false);
        const password = "Initial!Password123";
        const neighbor = await runWithMigrationBypass(async () =>
          User.create({
            name: "Neighbor",
            tenant_id: 3,
            email: "neighbor@example.test",
            password: await hashPassword(password),
            is_admin: false,
            email_verified_at: new Date().toISOString(),
          }),
        );
        const other = await client(origin, neighbor.get("email"), password);
        for (const replacement of [false, true]) {
          const email = `race-${replacement}@example.test`;
          const user = await runWithMigrationBypass(async () =>
            User.create({
              name: "Race",
              tenant_id: replacement ? 4 : 2,
              email,
              password: await hashPassword(password),
              is_admin: false,
              email_verified_at: new Date().toISOString(),
            }),
          );
          const id = Number(user.get("id"));
          let previousSecret: string | undefined;
          if (replacement) {
            const initial = await client(origin, email, password);
            expect((await initial.confirm()).status).toBe(302);
            previousSecret = await initial.setup();
            expect((await initial.submit(previousSecret)).status).toBe(200);
          }
          const actors = await Promise.all([
            client(origin, email, password, previousSecret),
            client(origin, email, password, previousSecret),
          ]);
          for (const actor of actors) expect((await actor.confirm()).status).toBe(302);
          const secrets = await Promise.all(actors.map((a) => a.setup()));
          expect(secrets[0]).not.toBe(secrets[1]);
          let ready = () => {};
          let acquisitionFailed = (_error: unknown) => {};
          const acquired = new Promise<void>((resolve, reject) => {
              ready = resolve;
              acquisitionFailed = reject;
            }),
            gate = new Promise<void>((r) => (release = r));
          held = admin.begin(async (tx) => {
            await tx.unsafe("LOCK TABLE users IN SHARE MODE");
            ready();
            await gate;
          });
          void held.catch(acquisitionFailed);
          await acquired;
          attempts = Promise.all(
            actors.map((actor, index) => {
              const secret = secrets[index];
              if (!secret) throw new Error("Missing concurrent setup secret");
              return actor.submit(secret);
            }),
          );
          let waiting = 0;
          const deadline = Date.now() + 7000;
          do {
            const [row] = await admin.unsafe(
              "SELECT COUNT(*)::int AS waiting FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%UPDATE%users%'",
            );
            waiting = row.waiting;
            if (waiting === 2) break;
            await Bun.sleep(20);
          } while (Date.now() < deadline);
          expect(waiting).toBe(2);
          release();
          await held;
          const responses = await attempts;
          const bodies = await Promise.all(responses.map((r) => r.text()));
          expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
          const winner = responses.findIndex((r) => r.status === 200);
          expect(bodies[1 - winner]).not.toContain("<h2>Recovery codes</h2>");
          const winningBody = bodies[winner],
            winningSecret = secrets[winner];
          if (!winningBody || !winningSecret) throw new Error("Missing winning setup response");
          const codes = recoveryCodes(winningBody);
          const row = await runWithMigrationBypass(() => User.find(id));
          expect(row.get("tenant_id")).toBe(replacement ? 4 : 2);
          expect(revealMfaSecret(row.get("mfa_secret"))).toBe(winningSecret);
          expect(JSON.parse(row.get("mfa_recovery_codes"))).toEqual(codes.map(hashRecoveryCode));
          for (const actor of actors) expect(await actor.statuses()).toEqual([401, 401, 401]);
          expect(await other.statuses()).toEqual([200, 200, 200]);
          const login = await client(origin, email, password, winningSecret);
          expect(await login.statuses()).toEqual([200, 200, 200]);
        }
      } finally {
        release();
        await held?.catch(() => {});
        await attempts?.catch(() => {});
        server.stop(true);
        await boot.context.dispose();
        await closeDatabase();
      }
    }),
  30000,
);
