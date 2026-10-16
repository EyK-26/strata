/** Actual generated CLI, route inventory, API-only OpenAPI and HTTP smoke acceptance. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createGeneratedSecurityApp } from "../tests/helpers/generatedSecurityApp.ts";

const repoRoot = join(import.meta.dir, "..");
const args = process.argv.slice(2);
assert.ok(
  args.every((arg) => arg === "--http" || arg === "--openapi"),
  "Unknown generated-runtime verification option.",
);
const checkOpenApi = args.length === 0 || args.includes("--openapi");
const checkHttp = args.length === 0 || args.includes("--http");
const fixture = await createGeneratedSecurityApp();
const cli = join(fixture.app, "node_modules/@getstrata/cli/cli.ts");
const env: Record<string, string | undefined> = {
  ...process.env,
  DATABASE_URL: fixture.runtimeUrl,
  APP_DATABASE_URL: fixture.runtimeUrl,
  MIGRATION_DATABASE_URL: fixture.migrationUrl,
  APP_ENV: "local",
  APP_DEBUG: "false",
  APP_NAME: "HiroApp",
  APP_KEY_PREFIX: `runtime_${crypto.randomUUID()}`,
  APP_URL: "http://localhost:3000",
  API_PREFIX: "/api",
  FRONTEND_MODE: "server-htmx",
  TENANCY_DRIVER: "rls",
  AUTH_DEV_HEADERS: "false",
  FEATURE_API_TOKENS: "true",
  FEATURE_MFA: "true",
  FEATURE_EMAIL_VERIFICATION: "true",
  FEATURE_SCIM: "true",
  FEATURE_SAML: "false",
  FEATURE_OAUTH: "false",
  FEATURE_REGISTRATION: "true",
  FEATURE_PUBLIC_READS: "false",
  CACHE_DRIVER: process.env.CACHE_DRIVER ?? "redis",
  QUEUE_DRIVER: "sync",
  MAIL_DRIVER: "log",
  SESSION_SECRET: "generated-runtime-fixture-session-secret-32-characters",
  TOKEN_HASH_PEPPER: "generated-runtime-fixture-pepper",
  METRICS_TOKEN: crypto.randomUUID(),
  PORT: "0",
};
delete env.DOGFOOD_APP;
delete env.HIROAPP_TEST;
delete env.STRATA_SCHEMA;

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
  await run([cli, "migrate", "--seed"]);
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
    assert.equal(
      actual,
      snapshot,
      "Generated API-only OpenAPI differs from the committed snapshot.",
    );
    await run([cli, "openapi:check"]);
    await Bun.write(specPath, '{"openapi":"3.1.0"}');
    const drift = await run([cli, "openapi:check"], { success: false });
    assert.equal(drift.code, 1);
    assert.match(drift.output, /OpenAPI spec drift detected/);
    await Bun.write(specPath, actual);
    await run([cli, "openapi:check"]);
    const spec = JSON.parse(actual);
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
      env,
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
      const match = /Listening on (http:\/\/localhost:\d+)/.exec(diagnostic);
      if (match) {
        origin = match[1];
        break;
      }
      await Bun.sleep(25);
    }
    assert.ok(origin, `Generated CLI did not start: ${diagnostic}`);
    const smokeEnv = { ...env, BASE_URL: origin, APP_URL: origin };
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
