/** Real installed make:module, OpenAPI and HTTP admission; no scaffold/guard replacements. */
import assert from "node:assert/strict";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { RedisClient } from "bun";
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
const cachedJson = process.argv.includes("--cached-json");
assert.ok(!cachedJson || withWeb, "Cache context qualification needs both API and web builders.");
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
let reservation: ReturnType<typeof Bun.serve> | undefined;
let origin = "";
const cli = join(fixture.app, "node_modules/@getstrata/cli/cli.ts");
const env = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      ["PATH", "HOME", "TMPDIR", "USER", "SHELL", "REDIS_URL"].includes(key),
    ),
  ),
  REDIS_URL: process.env.REDIS_URL,
  DATABASE_URL: fixture.runtimeUrl,
  APP_DATABASE_URL: fixture.runtimeUrl,
  MIGRATION_DATABASE_URL: "",
  APP_ENV: "local",
  APP_DEBUG: process.argv.includes("--diagnostic") ? "true" : "false",
  DB_CONNECTION: postgres ? "pgsql" : database,
  APP_URL: origin,
  PORT: "0",
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
  ...(cachedJson ? { FEATURE_ETAG: "true" } : {}),
};
const failures: unknown[] = [];
type PipedChild = ReturnType<typeof Bun.spawn<"ignore", "pipe", "pipe">>;
const activeCommands = new Set<PipedChild>();
let server: PipedChild | undefined, worker: PipedChild | undefined;
let serverObservation: Promise<PromiseSettledResult<unknown>[]> | undefined;
let workerObservation: Promise<PromiseSettledResult<unknown>[]> | undefined;
let serverOutput = "",
  serverError = "",
  workerOutput = "",
  workerError = "";
let redis: RedisClient | undefined;
let redisPrefixClaimed = false;
let redisBefore: string[] = [];
let redisReceipt:
  | { prefix: string; before: string[]; removed: string[]; after: string[] }
  | undefined;
const ownedRedisPrefix = env.APP_KEY_PREFIX;
let interrupted = false;
const interruption = new Error("Installed module verification interrupted by SIGTERM.");
const cancellation = new AbortController();
let terminationTimer: ReturnType<typeof setTimeout> | undefined;
function throwFailures(errors: unknown[], message: string): void {
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, message);
}
function checkInterrupted(): void {
  if (interrupted) throw interruption;
}
const terminate = () => {
  interrupted = true;
  process.exitCode = 143;
  cancellation.abort(interruption);
  for (const child of [server, worker, ...activeCommands]) {
    try {
      if (child?.exitCode === null) child.kill("SIGTERM");
    } catch (error) {
      failures.push(error);
    }
  }
  terminationTimer ??= setTimeout(() => {
    for (const child of [server, worker, ...activeCommands]) {
      try {
        if (child?.exitCode === null) child.kill("SIGKILL");
      } catch (error) {
        failures.push(error);
      }
    }
  }, 10000);
};
process.once("SIGTERM", terminate);
function request(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  checkInterrupted();
  return fetch(input, {
    ...init,
    signal: AbortSignal.any([cancellation.signal, init.signal ?? AbortSignal.timeout(10000)]),
  });
}
async function capture(
  stream: ReadableStream<Uint8Array>,
  append: (value: string) => void,
): Promise<void> {
  const reader = stream.getReader(),
    decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      append(decoder.decode(value, { stream: true }));
    }
    append(decoder.decode());
  } finally {
    reader.releaseLock();
  }
}
async function run(args: string[], extra: Record<string, string | undefined> = {}): Promise<void> {
  checkInterrupted();
  const child = Bun.spawn([process.execPath, ...args], {
    cwd: fixture.app,
    env: { ...env, ...extra },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60000,
    killSignal: "SIGKILL",
  });
  activeCommands.add(child);
  try {
    const results = await Promise.allSettled([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ] as const);
    const errors = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    const [terminal, out, err] = results;
    const output =
      (out.status === "fulfilled" ? out.value : "") + (err.status === "fulfilled" ? err.value : "");
    if (terminal.status === "fulfilled")
      try {
        assert.equal(terminal.value, 0, `Installed child ${args[0]} failed:\n${output}`);
      } catch (error) {
        errors.push(error);
      }
    if (interrupted) errors.push(interruption);
    throwFailures(errors, "Installed module child exit/output collection failed.");
  } finally {
    activeCommands.delete(child);
  }
}
async function command(args: string[], migration = false): Promise<void> {
  await run(
    [cli, ...args],
    migration
      ? {
          DATABASE_URL: fixture.migrationUrl,
          APP_DATABASE_URL: fixture.migrationUrl,
          MIGRATION_DATABASE_URL: fixture.migrationUrl,
        }
      : {},
  );
}
async function stopChild(
  child: PipedChild | undefined,
  observation: Promise<PromiseSettledResult<unknown>[]> | undefined,
  label: string,
): Promise<void> {
  if (!child) return;
  try {
    if (child.exitCode === null) child.kill("SIGTERM");
  } catch (error) {
    failures.push(error);
  }
  let forced = false;
  const timer = setTimeout(() => {
    try {
      if (child.exitCode === null) {
        forced = true;
        child.kill("SIGKILL");
      }
    } catch (error) {
      failures.push(error);
    }
  }, 10000);
  try {
    if (!observation) failures.push(new Error(`${label} observation was not registered.`));
    const results = await (observation ?? Promise.allSettled([child.exited]));
    for (const result of results) if (result.status === "rejected") failures.push(result.reason);
    const terminal = results[0];
    if (terminal?.status === "fulfilled")
      try {
        assert.equal(forced, false, `${label} must stop after SIGTERM.`);
        assert.equal(terminal.value, 0, `${label} must drain and exit successfully.`);
      } catch (error) {
        failures.push(error);
      }
  } catch (error) {
    failures.push(error);
  } finally {
    clearTimeout(timer);
  }
}
async function redisKeys(): Promise<string[]> {
  const client = redis;
  assert.ok(client);
  const keys = new Set<string>();
  let cursor = "0";
  do {
    const page = await client.send("SCAN", [
      cursor,
      "MATCH",
      `${ownedRedisPrefix}:*`,
      "COUNT",
      "100",
    ]);
    assert.ok(
      Array.isArray(page) &&
        page.length === 2 &&
        typeof page[0] === "string" &&
        Array.isArray(page[1]),
    );
    cursor = page[0];
    for (const key of page[1]) {
      assert.ok(typeof key === "string" && key.startsWith(`${ownedRedisPrefix}:`));
      keys.add(key);
    }
  } while (cursor !== "0");
  return [...keys].sort();
}
try {
  checkInterrupted();
  reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const port = reservation.port;
  assert.ok(port);
  await reservation.stop(true);
  reservation = undefined;
  origin = `http://127.0.0.1:${port}`;
  env.APP_URL = origin;
  env.PORT = String(port);
  if (mysql) {
    assert.match(ownedRedisPrefix, /^module_[a-f0-9-]+$/);
    assert.ok(
      env.REDIS_URL?.trim(),
      "MySQL module profiles require explicit owned Redis infrastructure.",
    );
    redis = new RedisClient(env.REDIS_URL, {
      autoReconnect: false,
      maxRetries: 0,
      connectionTimeout: 5000,
    });
    const before = await redisKeys();
    assert.deepEqual(before, [], "A newly owned UUID prefix must be empty before boot.");
    redisBefore = before;
    redisPrefixClaimed = true;
  }
  await writeFile(
    join(fixture.app, ".env"),
    (await readFile(join(fixture.app, ".env.example"), "utf8")).replace(
      /^MIGRATION_DATABASE_URL=.*$/gm,
      "MIGRATION_DATABASE_URL=",
    ),
  );
  const registerPath = join(fixture.app, "src/models/register.ts");
  const registerBefore = await readFile(registerPath, "utf8");
  await command(["make:module", "target", ...(withWeb ? ["--with-web"] : [])]);
  assert.equal(
    await readFile(registerPath, "utf8"),
    registerBefore,
    "Scaffolding must leave application repository registration unchanged.",
  );
  // Static composition supplies the SAME definition to runtime bindings and cache effects.
  const declaration = "export const repositoryDefinitions = Object.freeze([";
  assert.equal(registerBefore.split(declaration).length, 2);
  await writeFile(
    registerPath,
    "import {targetRepository} from '../modules/target/repository.ts';\n" +
      registerBefore.replace(declaration, `${declaration}targetRepository, `),
  );
  if (process.argv.includes("--typed-handlers")) {
    await writeFile(
      join(fixture.app, "src/modules/target/qualification.contract.ts"),
      await readFile(
        new URL("../tests/fixtures/generated-module-handlers.ts.template", import.meta.url),
        "utf8",
      ),
    );
  }
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
  if (cachedJson) {
    const directory = join(fixture.app, "src/modules/qualification-cache");
    await mkdir(directory);
    await writeFile(
      join(directory, "index.ts"),
      await readFile(
        new URL("../tests/fixtures/moduleCachedJson.ts.template", import.meta.url),
        "utf8",
      ),
    );
  }
  await command(["migrate", "--seed"], true);
  await run(["run", "check"]);
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
  checkInterrupted();
  server = Bun.spawn([process.execPath, cli, dev ? "dev" : "start"], {
    cwd: fixture.app,
    // Local start/dev owns schema setup before runtime; its runtime URLs stay restricted.
    env: { ...env, MIGRATION_DATABASE_URL: fixture.migrationUrl },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  serverObservation = Promise.allSettled([
    server.exited,
    capture(server.stdout, (value) => {
      serverOutput = (serverOutput + value).slice(-32768);
    }),
    capture(server.stderr, (value) => {
      serverError = (serverError + value).slice(-32768);
    }),
  ]);
  let ready = false;
  let health = "No HTTP response";
  for (let i = 0; i < 100; i++) {
    try {
      const response = await request(`${origin}/health`, { signal: AbortSignal.timeout(1000) });
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
    `Scaffolded ${auth} app must boot (${health}; readiness ${await request(`${origin}/ready`).then(
      (response) => response.text(),
      () => "unavailable",
    )}):\n${serverOutput}\n${serverError}`,
  );
  const csrf =
    auth === "headers"
      ? await (async () => {
          const response = await request(origin);
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
      const response = await request(origin + path, {
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
  if (crud && mysql) {
    checkInterrupted();
    worker = Bun.spawn([process.execPath, cli, "queue:work"], {
      cwd: fixture.app,
      env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    workerObservation = Promise.allSettled([
      worker.exited,
      capture(worker.stdout, (value) => {
        workerOutput = (workerOutput + value).slice(-32768);
      }),
      capture(worker.stderr, (value) => {
        workerError = (workerError + value).slice(-32768);
      }),
    ]);
  }
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
    const login = await request(origin + loginPath, {
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
    const json = await request(origin + apiBase, {
      headers: { ...identity, accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(json.status, 200, await json.clone().text());
    assert.match(json.headers.get("content-type") ?? "", /application\/json/);
    const collection = await json.json();
    assert.ok(collection && typeof collection === "object" && "data" in collection);
    assert.deepEqual(collection.data, [], "Denied writes must leave the module table empty.");
    const html = await request(`${origin}/targets`, {
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
      const response = await request(`${origin}/targets`, {
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
import type {Application} from '@getstrata/core/contracts/application';
import { ApiToken } from "./src/models/ApiToken.ts";
import { hashApiToken } from "@getstrata/core/auth/tokenHash";
let owner:Application|undefined;const errors:unknown[]=[];
try {
 const app=await bootstrapApp({migrate:false,mode:'command',onConstructed:application=>{owner=application;return undefined;}});
 const plain=process.env.MODULE_QUALIFICATION_TOKEN;assert.ok(plain);
 assert.equal(process.env.MIGRATION_DATABASE_URL??'','');
 await app.invoke({kind:'command',actor:{kind:'system',policy:'fixture.module-issued-token-grant'}},async({database})=>{
  const tokens=database.model(ApiToken);const hash=hashApiToken(plain);
  const token=await tokens.where({token_hash:hash}).first();assert.ok(token,'Grant only the token issued through actual login.');
  assert.equal(token.get('token_hash'),hash);
  await token.update({abilities:JSON.stringify(['targets:create','targets:update','targets:delete'])});
 });
}catch(error){errors.push(error);}
if(owner)try{const stopped=await owner.stop({reason:'Issued module token grant complete'});if(!stopped.successful)throw new Error('Module token grant owner did not stop cleanly',{cause:stopped});}catch(error){errors.push(error);}
if(errors.length===1)throw errors[0];if(errors.length>1)throw new AggregateError(errors,'Module token grant and cleanup failed.');
`,
    );
    await run([grantFile], { MODULE_QUALIFICATION_TOKEN: issuedToken });
    const call = (path: string, method = "GET", body?: object, conditional = false) =>
      request(origin + path, {
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
  if (cachedJson) {
    const { assertModuleCachedJson } = await import("../tests/helpers/assertModuleCachedJson");
    await assertModuleCachedJson(origin, apiPrefix, identity);
  }
  checkInterrupted();
} catch (error) {
  failures.push(error);
  if (server) console.error(`${serverOutput}\n${serverError}`);
  if (worker) console.error(`${workerOutput}\n${workerError}`);
} finally {
  // The body has joined every short child; stop each long owner independently.
  await stopChild(server, serverObservation, "Official HTTP CLI");
  await stopChild(worker, workerObservation, "Official queue worker");
  if (server)
    try {
      await assert.rejects(
        () => fetch(`${origin}/health`, { signal: AbortSignal.timeout(2000) }),
        "The owned HTTP listener must stop before its database is removed.",
      );
    } catch (error) {
      failures.push(error);
    }
  if (reservation)
    try {
      await reservation.stop(true);
    } catch (error) {
      failures.push(error);
    }
  if (redis) {
    if (redisPrefixClaimed)
      try {
        const before = await redisKeys();
        if (before.length) await redis.send("DEL", before);
        const after = await redisKeys();
        assert.deepEqual(after, [], "Owned Redis prefix must be empty after all producers stop.");
        redisReceipt = {
          prefix: `${ownedRedisPrefix}:`,
          before: redisBefore,
          removed: before,
          after,
        };
      } catch (error) {
        failures.push(error);
      }
    try {
      redis.close();
    } catch (error) {
      failures.push(error);
    }
  }
  try {
    await fixture.close();
  } catch (error) {
    failures.push(error);
  }
  if (terminationTimer) clearTimeout(terminationTimer);
  if (interrupted) failures.push(interruption);
  process.removeListener("SIGTERM", terminate);
}
// This records only confirmed Redis cleanup, even if another owner or the body failed.
if (redisReceipt) console.log(JSON.stringify({ ownedModuleRedisCleanup: redisReceipt }));
throwFailures(failures, "Installed module verification and cleanup failed.");
console.log(
  `PASS installed module ${database}/${auth}/${dev ? "dev" : "start"}: explicit repository registration, CLI module discovery, API-only OpenAPI, guest 401, unscoped identity 403 and shutdown`,
);
