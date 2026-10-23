/** Real installed consumers for the nine reported starter/framework compositions. */
import assert from "node:assert/strict";
import { copyFile } from "node:fs/promises";
import { join } from "node:path";
import { createGeneratedSecurityApp } from "../tests/helpers/generatedSecurityApp.ts";

const mode = process.argv[2] ?? "sso";
const engine = process.argv[3] ?? "sqlite";
const frontend = process.argv[4] ?? "api";
const queue = process.argv[5] ?? "sync";
const publishedVersion = process.argv
  .find((arg) => arg.startsWith("--published="))
  ?.slice("--published=".length);
assert.ok(["sso", "http", "webhook", "orm"].includes(mode));
assert.ok(queue === "sync" || queue === "redis");
if (engine !== "sqlite" && engine !== "mysql" && engine !== "postgres")
  throw new Error("Unknown SQL engine");
assert.ok(["api", "spa-react", "hybrid"].includes(frontend));
const fixture = await createGeneratedSecurityApp(
  engine,
  [
    `--frontend=${frontend}`,
    "--auth=cookie",
    "--tenancy=none",
    "--cache=array",
    `--queue=${queue}`,
    "--mail=log",
    "--no-email-verification",
    "--no-scim",
    "--no-metrics",
    "--spa-prefix=/console",
    ...(mode === "sso" ? [] : ["--no-mfa"]),
    ...(mode === "sso" ? ["--oidc", "--mfa"] : []),
    ...(mode === "webhook" ? ["--webhooks"] : []),
  ],
  { publishedVersion },
);

let active: ReturnType<typeof Bun.spawn> | undefined;
let closing: Promise<void> | undefined;
function cleanup(): Promise<void> {
  closing ??= (async () => {
    try {
      if (active && active.exitCode === null) {
        const child = active;
        const deadline = setTimeout(() => {
          if (child.exitCode === null) child.kill("SIGKILL");
        }, 5000);
        try {
          child.kill("SIGTERM");
          await child.exited;
        } finally {
          clearTimeout(deadline);
        }
      }
    } finally {
      await fixture.close();
    }
  })();
  return closing;
}
const terminate = () => {
  void cleanup().finally(() => process.exit(143));
};
process.once("SIGTERM", terminate);

async function run(command: string[], env: Record<string, string | undefined>): Promise<void> {
  const child = Bun.spawn(command, {
    cwd: fixture.app,
    env,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 120000,
    killSignal: "SIGTERM",
  });
  active = child;
  const [code, out, err] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  process.stdout.write(out);
  process.stderr.write(err);
  active = undefined;
  assert.equal(code, 0, `Installed ${mode}/${engine}/${frontend}/${queue} consumer failed`);
}

try {
  if (mode === "orm")
    await copyFile(
      join(import.meta.dir, "../tests/fixtures/starter-combinations/ormMigration.ts"),
      join(fixture.app, "src/db/migrations/9999_combination.ts"),
    );
  const env: Record<string, string | undefined> = {
    ...process.env,
    APP_ENV: "local",
    APP_DEBUG: "false",
    APP_NAME: "Combination acceptance",
    APP_KEY_PREFIX: `combination-${crypto.randomUUID()}`,
    APP_URL: "http://localhost:3000",
    FRONTEND_MODE: frontend,
    SPA_PREFIX: "/console",
    TENANCY_DRIVER: "none",
    AUTH_DEV_HEADERS: "false",
    CACHE_DRIVER: "array",
    QUEUE_DRIVER: queue,
    MAIL_DRIVER: "log",
    QUEUE_REDIS_TRANSPORT: "streams",
    QUEUE_MAX_ATTEMPTS: "3",
    QUEUE_BACKOFF_MS: "0",
    SESSION_SECRET: "owned-combination-session-secret-at-least32",
    TOKEN_HASH_PEPPER: "owned-combination-pepper",
    JWT_SECRET: "owned-combination-jwt-secret-at-least32",
    KMS_ENCRYPTION_KEY: Buffer.alloc(32, 19).toString("base64"),
    OAUTH_STATE_SECRET: "owned-combination-oauth-state-secret-at-least32",
    FEATURE_REGISTRATION: "true",
    FEATURE_MFA: mode === "sso" ? "true" : "false",
    FEATURE_EMAIL_VERIFICATION: "false",
    FEATURE_SAML: "false",
    FEATURE_SCIM: "false",
    WEBHOOK_ALLOW_PRIVATE: mode === "webhook" ? "true" : "false",
    DATABASE_URL: fixture.runtimeUrl,
    APP_DATABASE_URL: fixture.runtimeUrl,
  };
  await run(
    [process.execPath, join(fixture.app, "node_modules/@getstrata/cli/cli.ts"), "migrate"],
    {
      ...env,
      DATABASE_URL: fixture.migrationUrl,
      APP_DATABASE_URL: fixture.migrationUrl,
      MIGRATION_DATABASE_URL: fixture.migrationUrl,
    },
  );
  for (const name of [
    "MIGRATION_DATABASE_URL",
    "MYSQL_OBSERVABILITY_ADMIN_URL",
    "MYSQL_URL",
    "POSTGRES_PASSWORD",
    "STRATA_APP_PASSWORD",
    "STRATA_SCHEMA",
  ])
    delete env[name];
  if (mode === "http") {
    assert.ok(frontend === "spa-react" || frontend === "hybrid");
    await run([process.execPath, "run", "frontend:install"], env);
    await run([process.execPath, "run", "frontend:build"], env);
  }
  const probe = join(fixture.app, "combination-probe.ts");
  await copyFile(join(import.meta.dir, `../tests/fixtures/starter-combinations/${mode}.ts`), probe);
  await run([process.execPath, probe], env);
  console.log(
    JSON.stringify({
      acceptance: "starter-combinations",
      mode,
      engine,
      frontend,
      queue,
      packageSource: publishedVersion ?? "packed candidate",
    }),
  );
} finally {
  process.off("SIGTERM", terminate);
  await cleanup();
}
