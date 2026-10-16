/** Actual generated CLI, route inventory, API-only OpenAPI and HTTP smoke acceptance. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import {
  verifyGeneratedAuthHttp,
  verifyGeneratedScimHttp,
} from "../tests/helpers/generatedAuthHttp.ts";
import { createGeneratedSecurityApp } from "../tests/helpers/generatedSecurityApp.ts";

const repoRoot = join(import.meta.dir, "..");
const args = process.argv.slice(2);
assert.ok(
  args.every((arg) => ["--http", "--openapi", "--sqlite", "--mysql"].includes(arg)),
  "Unknown generated-runtime verification option.",
);
const selectedChecks = args.includes("--openapi") || args.includes("--http");
const checkOpenApi = !selectedChecks || args.includes("--openapi");
const checkHttp = !selectedChecks || args.includes("--http");
if (checkHttp)
  assert.ok(
    process.env.REDIS_URL?.trim(),
    "HTTP runtime acceptance requires explicit Redis infrastructure.",
  );
const sqlite = args.includes("--sqlite");
const mysql = args.includes("--mysql");
assert.ok(!(sqlite && mysql), "Select only one generated database engine.");
const columnTenancy = sqlite || mysql;
const fixture = await createGeneratedSecurityApp(sqlite ? "sqlite" : mysql ? "mysql" : "postgres");
const cli = join(fixture.app, "node_modules/@getstrata/cli/cli.ts");
const env: Record<string, string | undefined> = {
  ...process.env,
  DATABASE_URL: fixture.runtimeUrl,
  APP_DATABASE_URL: fixture.runtimeUrl,
  MIGRATION_DATABASE_URL: fixture.migrationUrl,
  APP_ENV: mysql ? "production" : "local",
  APP_DEBUG: "false",
  APP_NAME: "HiroApp",
  APP_KEY_PREFIX: `runtime_${crypto.randomUUID()}`,
  APP_URL: mysql ? "https://q01.example.test" : "http://localhost:3000",
  API_PREFIX: "/api",
  FRONTEND_MODE: "server-htmx",
  TENANCY_DRIVER: columnTenancy ? "column" : "rls",
  AUTH_DEV_HEADERS: "false",
  FEATURE_API_TOKENS: "true",
  FEATURE_MFA: "true",
  FEATURE_EMAIL_VERIFICATION: "true",
  FEATURE_SCIM: "true",
  SCIM_BEARER_TOKEN: mysql ? "q01-scim-tenant-1" : "",
  SCIM_TENANT_TOKENS: "1:q01-scim-tenant-1,2:q01-scim-tenant-2",
  FEATURE_SAML: "false",
  FEATURE_OAUTH: "false",
  FEATURE_REGISTRATION: "true",
  FEATURE_PUBLIC_READS: "false",
  CACHE_DRIVER: checkHttp ? "redis" : (process.env.CACHE_DRIVER ?? "array"),
  QUEUE_DRIVER: "sync",
  MAIL_DRIVER: "log",
  SESSION_SECRET: "generated-runtime-fixture-session-secret-32-characters",
  JWT_SECRET: "generated-runtime-fixture-jwt-secret-32-characters",
  TOKEN_HASH_PEPPER: "generated-runtime-fixture-pepper",
  API_TOKEN_DEFAULT_EXPIRY_DAYS: "30",
  KMS_ENCRYPTION_KEY: Buffer.alloc(32, 17).toString("base64"),
  METRICS_TOKEN: crypto.randomUUID(),
  PORT: "0",
  HOST: "127.0.0.1",
};
delete env.DOGFOOD_APP;
delete env.HIROAPP_TEST;
delete env.STRATA_SCHEMA;
if (mysql) {
  for (const name of [
    "MIGRATION_DATABASE_URL",
    "MYSQL_OBSERVABILITY_ADMIN_URL",
    "MYSQL_URL",
    "RLS_TEST_DATABASE_URL",
    "POSTGRES_PASSWORD",
    "STRATA_APP_PASSWORD",
    "ADMIN_API_TOKEN",
    "MEMBER_API_TOKEN",
  ])
    delete env[name];
}

async function run(
  args: string[],
  options: { cwd?: string; env?: Record<string, string | undefined>; success?: boolean } = {},
) {
  const child = Bun.spawn([process.execPath, ...args], {
    cwd: options.cwd ?? fixture.app,
    env: options.env ?? env,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60000,
    killSignal: "SIGKILL",
  });
  const [code, out, err] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  const output = `${out}${err}`;
  if (options.success !== false)
    assert.equal(code, 0, `Generated CLI ${args[0]} failed:\n${output.slice(-8192)}`);
  return { code, output };
}
let server: ReturnType<typeof Bun.spawn<"ignore", "pipe", "pipe">> | undefined;
let streams: Promise<void>[] = [];
let diagnostic = "";
async function capture(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader(),
    decoder = new TextDecoder();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      diagnostic = (diagnostic + decoder.decode(value, { stream: true })).slice(-32768);
    }
  } finally {
    reader.releaseLock();
  }
}
try {
  await run(
    [cli, "migrate", "--seed"],
    mysql
      ? {
          env: {
            ...env,
            APP_ENV: "local",
            DATABASE_URL: fixture.migrationUrl,
            APP_DATABASE_URL: fixture.migrationUrl,
          },
        }
      : {},
  );
  // Independent runtime inventory: metadata plus unregistered transport handlers,
  // using the same public map registrar that the former adapter used.
  const probe = join(fixture.app, "acceptance-routes.ts");
  await Bun.write(
    probe,
    `import {bootstrapApp} from './src/bootstrap/createApp.ts';
import {closeDatabase} from './src/bootstrap/database.ts';
import {routeRegistry} from '@getstrata/bootstrap/routeRegistry';
import {registerOpenApiRouteMap} from '@getstrata/bootstrap/buildModuleRoutes';
const app=await bootstrapApp({migrate:false});try{
registerOpenApiRouteMap(app.routes,[]);
const routes=[...new Set(routeRegistry.list().filter(r=>!r.path.includes('*')).map(r=>r.method+' '+r.path.replace(/:([A-Za-z0-9_]+)/g,'{$1}')))].sort();
await Bun.write('acceptance-routes.json',JSON.stringify(routes));
}finally{try{await app.context.dispose();}finally{await closeDatabase();}}`,
  );
  await run([probe]);
  if (columnTenancy) {
    const data = join(fixture.app, "acceptance-tenants.ts");
    await Bun.write(
      data,
      `import assert from 'node:assert/strict';
import {bootstrapApp} from './src/bootstrap/createApp.ts';
import {getSql,closeDatabase} from './src/bootstrap/database.ts';
import DefaultRepository,{BaseRepository} from '@getstrata/core/database/baseRepository';
import {defineTable} from '@getstrata/core/database/table';
const app=await bootstrapApp({migrate:false});try{
assert.equal(DefaultRepository,BaseRepository);
${
  mysql
    ? `const [identity]=await getSql().unsafe('SELECT CURRENT_USER() AS account');assert.match(identity.account,/^q01_[a-f0-9]+@/);
await assert.rejects(()=>getSql().unsafe('CREATE TABLE q01_forbidden_ddl (id INTEGER)'),{code:'ER_TABLEACCESS_DENIED_ERROR'});`
    : ""
}
const tenants=new DefaultRepository(defineTable<{id:number;slug:string},'id'>({name:'tenant',primaryKey:'id',columns:['id','slug']}),getSql());
const row=await tenants.create({slug:'q01-other'});assert.equal(row.id,2);
}finally{try{await app.context.dispose();}finally{await closeDatabase();}}`,
    );
    await run([data]);
  }

  const baseline = JSON.parse(
    await readFile(join(repoRoot, "tests/fixtures/generated-runtime-routes.json"), "utf8"),
  );
  const routes = JSON.parse(await readFile(join(fixture.app, "acceptance-routes.json"), "utf8"));
  assert.deepEqual(routes, baseline, "Generated runtime lost or changed a preserved route.");
  if (checkOpenApi) {
    await run([cli, "openapi:generate"]);
    await run([cli, "openapi:validate"]);
    const specPath = join(fixture.app, "docs/openapi.json");
    const snapshot = await readFile(join(repoRoot, "docs/openapi.json"), "utf8");
    const actual = await readFile(specPath, "utf8");
    // Production rejects localhost APP_URL. Compare every byte after changing
    // only the independently asserted server origins in the expected fixture.
    const expected = JSON.parse(snapshot);
    if (mysql) {
      const servers = [
        { url: `${env.APP_URL}/api`, description: "HiroApp API" },
        { url: env.APP_URL, description: "Root (health, metrics, SCIM)" },
      ];
      assert.deepEqual(JSON.parse(actual).servers, servers);
      expected.servers = servers;
    }
    assert.equal(
      actual,
      mysql ? `${JSON.stringify(expected, null, 2)}\n` : snapshot,
      "Generated API-only OpenAPI differs from the committed snapshot.",
    );
    await run([cli, "openapi:check"]);
    if (mysql) {
      const listed = await run([cli, "queue:failed"]);
      assert.match(listed.output, /No failed jobs/);
      const flushed = await run([cli, "queue:flush-failed"]);
      assert.match(flushed.output, /Removed 0 failed job/);
      const retry = await run([cli, "queue:retry", "999999"], { success: false });
      assert.equal(retry.code, 1);
      assert.match(retry.output, /not found/i);
    }
    await Bun.write(specPath, '{"openapi":"3.1.0"}');
    const drift = await run([cli, "openapi:check"], { success: false });
    assert.equal(drift.code, 1);
    assert.match(drift.output, /OpenAPI spec drift detected/);
    await Bun.write(specPath, actual);
    await run([cli, "openapi:check"]);
    const spec = JSON.parse(actual);
    // Resolve the candidate package installed into this fixture, not a monorepo alias.
    const require = createRequire(join(fixture.app, "package.json"));
    const { renderTypeScriptSdk } = await import(
      require.resolve("@getstrata/core/openapi/generator")
    );
    const previousName = process.env.APP_NAME;
    const previousClass = process.env.APP_SDK_CLASS;
    try {
      process.env.APP_NAME = env.APP_NAME;
      delete process.env.APP_SDK_CLASS;
      const sdkSnapshot = await readFile(join(repoRoot, "sdk/typescript/client.ts"), "utf8");
      const defaultOrigin = 'private readonly baseUrl = "http://localhost:3000/api"';
      if (mysql) assert.equal(sdkSnapshot.split(defaultOrigin).length, 2);
      assert.equal(
        renderTypeScriptSdk(spec, "/api"),
        mysql
          ? sdkSnapshot.replace(
              defaultOrigin,
              `private readonly baseUrl = ${JSON.stringify(`${env.APP_URL}/api`)}`,
            )
          : sdkSnapshot,
        "Generated API-only SDK differs from the committed snapshot.",
      );
    } finally {
      if (previousName === undefined) delete process.env.APP_NAME;
      else process.env.APP_NAME = previousName;
      if (previousClass === undefined) delete process.env.APP_SDK_CLASS;
      else process.env.APP_SDK_CLASS = previousClass;
    }

    for (const path of Object.keys(spec.paths)) {
      assert.ok(
        !/^(?:\/$|\/login(?:\/|$)|\/register$|\/logout$|\/account\/|\/confirm-password$|\/forgot-password$|\/reset-password$|\/email\/|\/app(?:\/|$)|\/assets\/)/.test(
          path,
        ),
        `HTML/SPA path leaked into OpenAPI: ${path}`,
      );
    }
    console.log(
      `Generated CLI OpenAPI passed (${Object.values(spec.paths).reduce((n: number, ops) => n + Object.keys(ops as object).length, 0)} API operations, ${routes.length} preserved runtime operations, drift rejection).`,
    );
  }
  if (checkHttp) {
    server = Bun.spawn([process.execPath, cli, "start"], {
      cwd: fixture.app,
      // Only this owned diagnostic fixture exposes dependency observations.
      env: { ...env, APP_DEBUG: "true" },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    streams = [capture(server.stdout), capture(server.stderr)];
    const deadline = Date.now() + 30000;
    let origin: string | undefined;
    while (Date.now() < deadline) {
      if (server.exitCode !== null)
        throw new Error(
          `Generated CLI exited before admission (${server.exitCode}): ${diagnostic}`,
        );
      const match = /Listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(diagnostic);
      if (match) {
        origin = match[1];
        break;
      }
      await Bun.sleep(25);
    }
    assert.ok(origin, `Generated CLI did not start: ${diagnostic}`);
    const readiness = await fetch(`${origin}/ready`, { signal: AbortSignal.timeout(5000) });
    assert.equal(readiness.status, 200);
    const readinessBody: unknown = await readiness.json();
    assert.ok(readinessBody && typeof readinessBody === "object" && "checks" in readinessBody);
    assert.deepEqual(
      readinessBody.checks,
      { database: "ok", redis: "ok" },
      "Readiness must actually observe both dependencies, without skipped Redis.",
    );
    // Owned loopback transport sends the configured public virtual host. This
    // exercises production host selection; it does not qualify deployed TLS.
    const requestHost = mysql ? new URL(env.APP_URL ?? "").host : undefined;
    if (mysql) {
      const unknownHost = await fetch(`${origin}/api/v1/auth/csrf`);
      assert.equal(unknownHost.status, 403);
      assert.deepEqual(await unknownHost.json(), { error: "Tenant host not found." });
    }
    await verifyGeneratedAuthHttp(origin, requestHost);
    if (columnTenancy) await verifyGeneratedScimHttp(origin, requestHost);
    console.log(
      "Generated HTTP cookie/token/JWT admission, CSRF, provider gates and credential-specific logout passed.",
    );
    if (sqlite) console.log("SQLite SCIM repeated cross-tenant CRUD/read isolation passed.");
    if (mysql)
      console.log(
        "MySQL SCIM repeated cross-tenant CRUD/read isolation passed (DML-only production runtime).",
      );
    const smokeEnv = { ...env, BASE_URL: origin, APP_URL: origin, SMOKE_HOST: requestHost };
    await run([join(repoRoot, "scripts/smoke-test.ts")], { cwd: repoRoot, env: smokeEnv });
    await run([join(repoRoot, "scripts/smoke-webview.ts")], { cwd: repoRoot, env: smokeEnv });
    const denied = await fetch(`${origin}/metrics`, { signal: AbortSignal.timeout(5000) });
    await denied.text();
    assert.equal(denied.status, 404);
    console.log(
      "Generated CLI start, health/readiness, authenticated metrics, login and WebView smoke passed.",
    );
  }
} finally {
  try {
    if (server) {
      if (server.exitCode === null) server.kill("SIGTERM");
      const timer = setTimeout(() => server?.kill("SIGKILL"), 15000);
      try {
        const code = await server.exited;
        await Promise.all(streams);
        assert.equal(code, 0, `Generated CLI did not drain cleanly: ${diagnostic}`);
      } finally {
        clearTimeout(timer);
      }
    }
  } finally {
    await fixture.close();
  }
}
