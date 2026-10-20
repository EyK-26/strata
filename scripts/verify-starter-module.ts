/** Real installed make:module, OpenAPI and HTTP admission; no scaffold/guard replacements. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createGeneratedSecurityApp } from "../tests/helpers/generatedSecurityApp";
import { jsonCsrfHeaders, mergeCookies } from "../tests/helpers/jsonCsrf";

const auth = process.argv.find((arg) => arg.startsWith("--auth="))?.slice(7) ?? "cookie";
assert.ok(["headers", "cookie", "token", "jwt", "cookie-token", "cookie-token-jwt"].includes(auth));
const mysql = process.argv.includes("--mysql");
const publishedVersion = process.argv.find((arg) => arg.startsWith("--published="))?.slice(12);
const dev = process.argv.includes("--dev");
const withWeb = process.argv.includes("--with-web");
const fixture = await createGeneratedSecurityApp(
  mysql ? "mysql" : "sqlite",
  [
    "--frontend=server-htmx",
    `--auth=${auth}`,
    "--tenancy=none",
    `--cache=${mysql ? "redis" : "array"}`,
    `--queue=${mysql ? "redis" : "sync"}`,
    "--mail=smtp",
    "--mfa",
    "--email-verification",
    "--no-scim",
    "--no-metrics",
    "--no-docker",
  ],
  { publishedVersion, parentDirectory: process.env.STARTER_JOURNEY_PARENT },
);
const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
const port = reservation.port;
await reservation.stop(true);
const origin = `http://127.0.0.1:${port}`;
const cli = join(fixture.app, "node_modules/@getstrata/cli/cli.ts");
const env = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      ["PATH", "HOME", "TMPDIR", "USER", "SHELL", "REDIS_URL"].includes(key),
    ),
  ),
  DATABASE_URL: fixture.runtimeUrl,
  APP_DATABASE_URL: fixture.runtimeUrl,
  MIGRATION_DATABASE_URL: fixture.migrationUrl,
  APP_ENV: "local",
  APP_DEBUG: process.argv.includes("--diagnostic") ? "true" : "false",
  DB_CONNECTION: mysql ? "mysql" : "sqlite",
  APP_URL: origin,
  PORT: String(port),
  HOST: "127.0.0.1",
  API_PREFIX: "/api/v1",
  FRONTEND_MODE: "server-htmx",
  TENANCY_DRIVER: "none",
  APP_KEY_PREFIX: `module_${crypto.randomUUID()}`,
  AUTH_DEV_HEADERS: auth === "headers" ? "true" : "false",
  TENANT_DEV_HEADERS: "false",
  FEATURE_MFA: "true",
  FEATURE_EMAIL_VERIFICATION: "true",
  FEATURE_API_TOKENS: "true",
  FEATURE_SCIM: "false",
  FEATURE_SAML: "false",
  FEATURE_OAUTH: "false",
  SESSION_SECRET: "owned-module-session-secret-at-least-32-characters",
  JWT_SECRET: "owned-module-jwt-secret-at-least-32-characters",
  TOKEN_HASH_PEPPER: "owned-module-pepper",
  KMS_ENCRYPTION_KEY: "a".repeat(64),
  CACHE_DRIVER: mysql ? "redis" : "array",
  QUEUE_DRIVER: mysql ? "redis" : "sync",
  MAIL_DRIVER: "smtp",
  MAIL_HOST: "127.0.0.1",
  MAIL_PORT: "1025",
  MAIL_SECURE: "false",
  OTEL_SDK_DISABLED: "true",
};
async function command(args: string[], migration = false) {
  const child = Bun.spawn([process.execPath, cli, ...args], {
    cwd: fixture.app,
    env: migration
      ? { ...env, DATABASE_URL: fixture.migrationUrl, APP_DATABASE_URL: fixture.migrationUrl }
      : env,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60000,
    killSignal: "SIGTERM",
  });
  const [code, out, err] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  assert.equal(code, 0, `Installed CLI ${args[0]} failed:\n${out}${err}`);
}
let server: ReturnType<typeof Bun.spawn> | undefined;
let cleaning: Promise<void> | undefined;
function cleanup() {
  cleaning ??= (async () => {
    try {
      if (server && server.exitCode === null) {
        server.kill("SIGTERM");
        let deadline: ReturnType<typeof setTimeout> | undefined;
        const result = await Promise.race([
          server.exited,
          new Promise<"timeout">((resolve) => {
            deadline = setTimeout(() => resolve("timeout"), 10000);
          }),
        ]);
        clearTimeout(deadline);
        if (result === "timeout") server.kill("SIGKILL");
        assert.notEqual(result, "timeout", "Owned CLI and its server must stop after SIGTERM.");
        assert.equal(result, 0, "The official CLI must drain and exit successfully.");
        await assert.rejects(
          () => fetch(`${origin}/health`, { signal: AbortSignal.timeout(2000) }),
          "The owned HTTP listener must stop before its database is removed.",
        );
      }
    } finally {
      await fixture.close();
    }
  })();
  return cleaning;
}
const terminate = () => {
  void cleanup().finally(() => process.exit(143));
};
process.once("SIGTERM", terminate);
try {
  await writeFile(
    join(fixture.app, ".env"),
    await readFile(join(fixture.app, ".env.example"), "utf8"),
  );
  await command(["make:module", "target", ...(withWeb ? ["--with-web"] : [])]);
  await command(["migrate", "--seed"], true);
  // Boot actual route discovery after scaffolding, not just a compilation or
  // pre-scaffold server. This must work even without opaque-token auth.
  await command(["openapi:generate"]);
  await command(["openapi:check"]);
  const spec = JSON.parse(await readFile(join(fixture.app, "docs/openapi.json"), "utf8"));
  assert.ok(spec.paths["/targets"].post);
  assert.ok(spec.paths["/targets/{id}"].patch);
  assert.ok(spec.paths["/targets/{id}"].delete);
  assert.equal(spec.paths["/login"], undefined);
  server = Bun.spawn([process.execPath, cli, dev ? "dev" : "start"], {
    cwd: fixture.app,
    env,
    stdout: Bun.file(join(fixture.app, "server.log")),
    stderr: Bun.file(join(fixture.app, "server.error.log")),
  });
  let ready = false;
  let health = "No HTTP response";
  for (let i = 0; i < 100; i++) {
    try {
      const response = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(1000) });
      ready = response.ok;
      health = `${response.status}: ${await response.text()}`;
    } catch (error) {
      health = error instanceof Error ? error.message : String(error);
    }
    if (ready || server.exitCode !== null) break;
    await Bun.sleep(100);
  }
  assert.ok(
    ready,
    `Scaffolded ${auth} app must boot (${health}; readiness ${await fetch(`${origin}/ready`).then(
      (response) => response.text(),
      () => "unavailable",
    )}):\n${await readFile(join(fixture.app, "server.log"), "utf8")}\n${await readFile(join(fixture.app, "server.error.log"), "utf8")}`,
  );
  const csrf =
    auth === "headers"
      ? await (async () => {
          const response = await fetch(origin);
          const cookie = mergeCookies(response);
          const { csrfCookieValue } = await import("../tests/helpers/jsonCsrf");
          const token = csrfCookieValue(cookie);
          assert.ok(token, "The real HTML response must issue the guest CSRF cookie.");
          return {
            token,
            cookie,
            headers: { cookie, origin, "x-csrf-token": token, "content-type": "application/json" },
          };
        })()
      : await jsonCsrfHeaders(origin);
  async function mutate(headers: Record<string, string>, expected: number) {
    for (const [method, path] of [
      ["POST", "/targets"],
      ["PATCH", "/targets/1"],
      ["DELETE", "/targets/1"],
    ]) {
      const response = await fetch(origin + path, {
        method,
        headers: { ...csrf.headers, ...headers },
        body: JSON.stringify({ name: "Not admitted" }),
        redirect: "manual",
        signal: AbortSignal.timeout(5000),
      });
      assert.equal(
        response.status,
        expected,
        `${auth} ${method} ${path}: ${await response.text()}`,
      );
    }
  }
  await mutate({}, 401);
  let identity: Record<string, string>;
  if (auth === "headers") {
    identity = {
      "x-authenticated-user-id": "7",
      "x-authenticated-user-role": "member",
      "x-authenticated-email-verified": "true",
    };
  } else {
    const cookieAuth = auth.includes("cookie");
    const loginPath = cookieAuth
      ? "/login"
      : auth === "jwt"
        ? "/api/auth/token"
        : "/api/v1/auth/login";
    const login = await fetch(origin + loginPath, {
      method: "POST",
      headers: {
        ...csrf.headers,
        "content-type": cookieAuth ? "application/x-www-form-urlencoded" : "application/json",
      },
      body: cookieAuth
        ? new URLSearchParams({
            _token: csrf.token,
            email: "demo@example.com",
            password: "StrataDemo!ChangeMe",
          })
        : JSON.stringify({ email: "demo@example.com", password: "StrataDemo!ChangeMe" }),
      redirect: "manual",
    });
    assert.equal(login.status, cookieAuth ? 302 : 200, await login.clone().text());
    if (cookieAuth) identity = { cookie: mergeCookies(login, csrf.cookie) };
    else {
      const payload = await login.json();
      assert.ok(payload && typeof payload === "object" && "token" in payload);
      assert.equal(typeof payload.token, "string");
      identity = { authorization: `Bearer ${payload.token}` };
    }
  }
  await mutate(identity, 403);
  console.log(
    `PASS installed module ${mysql ? "mysql" : "sqlite"}/${auth}/${dev ? "dev" : "start"}: CLI discovery, API-only OpenAPI, guest 401, unscoped identity 403 and shutdown`,
  );
} finally {
  process.removeListener("SIGTERM", terminate);
  await cleanup();
}
