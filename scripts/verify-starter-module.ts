/** Real installed make:module, OpenAPI and HTTP admission; no scaffold/guard replacements. */
import assert from "node:assert/strict";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createGeneratedSecurityApp } from "../tests/helpers/generatedSecurityApp";
import { jsonCsrfHeaders, mergeCookies } from "../tests/helpers/jsonCsrf";

const auth = process.argv.find((arg) => arg.startsWith("--auth="))?.slice(7) ?? "cookie";
assert.ok(["headers", "cookie", "token", "jwt", "cookie-token", "cookie-token-jwt"].includes(auth));
const mysql = process.argv.includes("--mysql");
const postgres = process.argv.includes("--postgres");
assert.ok(!(mysql && postgres), "Choose one database.");
const database = mysql ? "mysql" : postgres ? "postgres" : "sqlite";
const publishedVersion = process.argv.find((arg) => arg.startsWith("--published="))?.slice(12);
const dev = process.argv.includes("--dev");
const withWeb = process.argv.includes("--with-web");
const apiPrefix =
  process.argv.find((arg) => arg.startsWith("--api-prefix="))?.slice(13) ?? "/api/v1";
const apiBase = withWeb ? `${apiPrefix}/targets` : "/targets";
const crud = process.argv.includes("--crud");
assert.ok(
  !crud || (withWeb && auth === "token"),
  "Scoped CRUD uses an issued opaque fixture token and an app-owned module schema.",
);
const fixture = await createGeneratedSecurityApp(
  database,
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
  DB_CONNECTION: postgres ? "pgsql" : database,
  APP_URL: origin,
  PORT: String(port),
  HOST: "127.0.0.1",
  API_PREFIX: apiPrefix,
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
let worker: ReturnType<typeof Bun.spawn> | undefined;
let cleaning: Promise<void> | undefined;
function cleanup() {
  cleaning ??= (async () => {
    try {
      for (const child of [server, worker]) {
        if (!child || child.exitCode !== null) continue;
        child.kill("SIGTERM");
        let deadline: ReturnType<typeof setTimeout> | undefined;
        const result = await Promise.race([
          child.exited,
          new Promise<"timeout">((resolve) => {
            deadline = setTimeout(() => resolve("timeout"), 10000);
          }),
        ]);
        clearTimeout(deadline);
        if (result === "timeout") {
          child.kill("SIGKILL");
          await child.exited;
        }
        assert.notEqual(result, "timeout", "Owned CLI and its server must stop after SIGTERM.");
        assert.equal(result, 0, "The official CLI must drain and exit successfully.");
        if (child === server)
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
  if (withWeb) {
    await command(["make:migration", "create_target"]);
    const directory = join(fixture.app, "src/db/migrations");
    const file = (await readdir(directory)).find((name) => name.endsWith("_create_target.ts"));
    assert.ok(file, "The installed CLI must generate the module's migration.");
    await writeFile(
      join(directory, file),
      `import type { Migration } from "@getstrata/core/database/migrations/types";
import { Schema, resolveDatabaseDriver } from "@getstrata/core/database/schema";
const migration: Migration = {
 name: ${JSON.stringify(file.slice(0, -3))},
 async up(db) { await Schema.run(db, resolveDatabaseDriver(), schema => { schema.create("target", table => { table.id(); table.string("name"); }); }); },
 async down(db) { await Schema.run(db, resolveDatabaseDriver(), schema => { schema.drop("target"); }); },
};
export default migration;
`,
    );
  }
  await command(["migrate", "--seed"], true);
  const typecheck = Bun.spawn([process.execPath, "run", "check"], {
    cwd: fixture.app,
    env,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60000,
  });
  const [typecheckCode, typecheckOut, typecheckError] = await Promise.all([
    typecheck.exited,
    new Response(typecheck.stdout).text(),
    new Response(typecheck.stderr).text(),
  ]);
  assert.equal(
    typecheckCode,
    0,
    `The actual generated module must typecheck against installed packages:\n${typecheckOut}${typecheckError}`,
  );
  // Boot actual route discovery after scaffolding, not just a compilation or
  // pre-scaffold server. This must work even without opaque-token auth.
  await command(["openapi:generate"]);
  await command(["openapi:check"]);
  const spec = JSON.parse(await readFile(join(fixture.app, "docs/openapi.json"), "utf8"));
  assert.ok(spec.paths[apiBase].post);
  assert.ok(spec.paths[`${apiBase}/{id}`].patch);
  assert.ok(spec.paths[`${apiBase}/{id}`].delete);
  assert.equal(spec.paths["/login"], undefined);
  if (withWeb)
    assert.equal(
      spec.paths["/targets"],
      undefined,
      "HTML collection must be absent from API-only OpenAPI.",
    );
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
      ["POST", apiBase],
      ["PATCH", `${apiBase}/1`],
      ["DELETE", `${apiBase}/1`],
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
  if (crud && mysql)
    worker = Bun.spawn([process.execPath, cli, "queue:work"], {
      cwd: fixture.app,
      env,
      stdout: Bun.file(join(fixture.app, "worker.log")),
      stderr: Bun.file(join(fixture.app, "worker.error.log")),
    });
  let identity: Record<string, string>;
  let issuedToken: string | undefined;
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
      assert.ok(typeof payload.token === "string");
      issuedToken = payload.token;
      identity = { authorization: `Bearer ${issuedToken}` };
    }
  }
  await mutate(identity, 403);
  if (withWeb) {
    const json = await fetch(origin + apiBase, {
      headers: { ...identity, accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(json.status, 200, await json.clone().text());
    assert.match(json.headers.get("content-type") ?? "", /application\/json/);
    const collection = await json.json();
    assert.ok(collection && typeof collection === "object" && "data" in collection);
    assert.deepEqual(collection.data, [], "Denied writes must leave the module table empty.");
    const html = await fetch(`${origin}/targets`, {
      headers: { ...identity, accept: "text/html" },
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(html.status, 200, await html.clone().text());
    assert.match(html.headers.get("content-type") ?? "", /text\/html/);
    const fullPage = await html.text();
    assert.match(fullPage, /<h1>Targets<\/h1>/);
    assert.match(fullPage, /<title>Targets/);
    for (const [extra, fragment] of [
      [{ "HX-Request": "true" }, true],
      [{ "HX-Request": "true", "HX-Boosted": "true" }, false],
      [{ "HX-Request": "true", "HX-History-Restore-Request": "true" }, false],
    ] as const) {
      const response = await fetch(`${origin}/targets`, {
        headers: { ...identity, accept: "text/html", ...extra },
        redirect: "manual",
        signal: AbortSignal.timeout(5000),
      });
      assert.equal(response.status, 200, await response.clone().text());
      const body = await response.text();
      assert.match(body, /<h1>Targets<\/h1>/);
      assert.equal(/<!doctype html>/i.test(body), !fragment);
      for (const header of ["HX-Request", "HX-Boosted", "HX-History-Restore-Request"]) {
        assert.ok(response.headers.get("vary")?.toLowerCase().includes(header.toLowerCase()));
      }
    }
  }
  if (crud) {
    assert.ok(issuedToken);
    const grantFile = join(fixture.app, "qualification-grant.ts");
    await writeFile(
      grantFile,
      `import assert from "node:assert/strict";
import { bootstrapApp } from "./src/bootstrap/createApp.ts";
import { closeDatabase } from "./src/bootstrap/database.ts";
import { ApiToken } from "./src/models/ApiToken.ts";
import { hashApiToken } from "@getstrata/core/auth/tokenHash";
const { context } = await bootstrapApp({ migrate: false });
try {
 const plain = process.env.MODULE_QUALIFICATION_TOKEN;
 assert.ok(plain);
 const token = await ApiToken.where({ token_hash: hashApiToken(plain) }).first();
 assert.ok(token, "Grant only the token issued through actual login.");
 await token.update({ abilities: JSON.stringify(["targets:create", "targets:update", "targets:delete"]) });
} finally { try { await context.dispose(); } finally { await closeDatabase(); } }
`,
    );
    const grant = Bun.spawn([process.execPath, grantFile], {
      cwd: fixture.app,
      env: { ...env, MODULE_QUALIFICATION_TOKEN: issuedToken },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 60000,
    });
    const [grantCode, grantOut, grantError] = await Promise.all([
      grant.exited,
      new Response(grant.stdout).text(),
      new Response(grant.stderr).text(),
    ]);
    assert.equal(grantCode, 0, grantOut + grantError);
    const call = (path: string, method = "GET", body?: object, conditional = false) =>
      fetch(origin + path, {
        method,
        headers: { ...csrf.headers, ...identity, ...(conditional ? { "if-match": "*" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        redirect: "manual",
        signal: AbortSignal.timeout(5000),
      });
    const created = await call(apiBase, "POST", { name: "Created through scoped API" });
    assert.equal(created.status, 201, await created.clone().text());
    const record = await created.json();
    assert.ok(
      record && typeof record === "object" && "id" in record && typeof record.id === "number",
    );
    const detail = `${apiBase}/${record.id}`;
    const read = await call(detail);
    assert.equal(read.status, 200, await read.clone().text());
    assert.deepEqual(await read.json(), record);
    async function visible(name: string | null) {
      let matched = false;
      for (let i = 0; i < 10; i++) {
        const response = await call(apiBase);
        assert.equal(response.status, 200, await response.clone().text());
        const value = await response.json();
        assert.ok(
          value && typeof value === "object" && "data" in value && Array.isArray(value.data),
        );
        matched =
          name === null
            ? value.data.length === 0
            : value.data.length === 1 && value.data[0]?.name === name;
        if (matched) break;
        await Bun.sleep(1000);
      }
      assert.ok(
        matched,
        "Official sync/Redis worker cache invalidation must expose actual CRUD state.",
      );
    }
    await visible("Created through scoped API");
    const precondition = await call(detail, "PATCH", { name: "Rejected without condition" });
    assert.equal(precondition.status, 412, await precondition.clone().text());
    const updated = await call(detail, "PATCH", { name: "Updated through ORM" }, true);
    assert.equal(updated.status, 200, await updated.clone().text());
    const updatedRecord = await updated.json();
    assert.ok(updatedRecord && typeof updatedRecord === "object" && "name" in updatedRecord);
    assert.equal(updatedRecord.name, "Updated through ORM");
    await visible("Updated through ORM");
    const deleted = await call(detail, "DELETE", undefined, true);
    assert.equal(deleted.status, 204, await deleted.clone().text());
    await visible(null);
    for (const method of ["GET", "PATCH", "DELETE"]) {
      const absent = await call(
        detail,
        method,
        method === "PATCH" ? { name: "Cannot return" } : undefined,
        method !== "GET",
      );
      assert.equal(absent.status, 404, `${method} missing record: ${await absent.text()}`);
    }
  }
  console.log(
    `PASS installed module ${database}/${auth}/${dev ? "dev" : "start"}: CLI discovery, API-only OpenAPI, guest 401, unscoped identity 403 and shutdown`,
  );
} catch (error) {
  if (server) {
    console.error(await readFile(join(fixture.app, "server.log"), "utf8").catch(() => ""));
    console.error(await readFile(join(fixture.app, "server.error.log"), "utf8").catch(() => ""));
  }
  throw error;
} finally {
  process.removeListener("SIGTERM", terminate);
  await cleanup();
}
