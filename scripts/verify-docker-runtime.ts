import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeOwnedDockerContainers } from "../tests/helpers/ownedDockerContainers";

const root = join(import.meta.dir, "..");
const id = crypto.randomUUID().replaceAll("-", "");
const image = `strata-acceptance:${id}`;
const database = `strata-docker-db-${id}`;
const server = `strata-docker-http-${id}`;
const migration = `strata-docker-migrate-${id}`;
const redis = `strata-docker-redis-${id}`;
const networkName = `strata-docker-network-${id}`;
let networkCreated = false;
let edge: ReturnType<typeof Bun.serve> | undefined;
const redisPassword = crypto.randomUUID().replaceAll("-", "");
const secrets = Array.from({ length: 5 }, () => crypto.randomUUID().replaceAll("-", ""));
const [adminPassword, appPassword, session, pepper, metrics] = secrets as [
  string,
  string,
  string,
  string,
  string,
];
const encryptionKey =
  crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
secrets.push(encryptionKey, redisPassword);
const directory = await mkdtemp(join(tmpdir(), "strata-docker-"));

async function run(
  args: string[],
  timeout = 60000,
  expected = 0,
  environment: Record<string, string> = {},
) {
  const child = Bun.spawn(args, {
    cwd: root,
    env: { ...process.env, ...environment },
    stdout: "pipe",
    stderr: "pipe",
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), timeout);
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code !== expected) {
      let diagnostic = `${stdout}\n${stderr}`.slice(-16000);
      for (const secret of secrets) diagnostic = diagnostic.replaceAll(secret, "[redacted]");
      throw new Error(`${args[0]} ${args[1]} exited ${code}, expected ${expected}: ${diagnostic}`);
    }
    let output = `${stdout}\n${stderr}`.trim();
    for (const secret of secrets) output = output.replaceAll(secret, "[redacted]");
    return output;
  } finally {
    clearTimeout(timer);
  }
}

try {
  const configEnv = {
    APP_ENV: "production",
    APP_URL: "https://docker-acceptance.example.test",
    POSTGRES_USER: "postgres",
    POSTGRES_DB: "docker_acceptance",
    POSTGRES_PASSWORD: adminPassword,
    STRATA_APP_PASSWORD: appPassword,
    REDIS_PASSWORD: redisPassword,
    SESSION_SECRET: session,
    TOKEN_HASH_PEPPER: pepper,
    JWT_SECRET: pepper,
    METRICS_TOKEN: metrics,
  };
  for (const overlay of [false, true]) {
    const files = [
      "-f",
      "docker-compose.prod.yml",
      ...(overlay ? ["-f", "docker-compose.staging.yml"] : []),
    ];
    const config = JSON.parse(
      await run(
        [
          "docker",
          "compose",
          ...files,
          "--profile",
          "administration",
          "config",
          "--format",
          "json",
        ],
        60000,
        0,
        configEnv,
      ),
    );
    for (const service of ["app", "worker"]) {
      assert.equal(config.services[service].environment.MIGRATION_DATABASE_URL, undefined);
      assert.equal(
        new URL(config.services[service].environment.DATABASE_URL).username,
        "strata_app",
      );
      assert.ok(!config.services[service].command.includes("migrate"));
      assert.ok(!config.services[service].command.includes("seed"));
    }
    assert.equal(
      new URL(config.services.migrate.environment.MIGRATION_DATABASE_URL).username,
      "postgres",
    );
    assert.ok(config.services.migrate.command.includes("migrate"));
  }
  console.log("Building generated candidate acceptance image...");
  await run(["docker", "build", "--target", "release", "-t", image, "."], 240000);
  await run(["docker", "network", "create", networkName]);
  networkCreated = true;
  await run([
    "docker",
    "run",
    "-d",
    "--name",
    redis,
    "--network",
    networkName,
    "redis:7.4-alpine",
    "redis-server",
    "--requirepass",
    redisPassword,
  ]);
  const postgresEnv = join(directory, "postgres.env");
  await writeFile(postgresEnv, `POSTGRES_PASSWORD=${adminPassword}\n`, { mode: 0o600 });
  await run([
    "docker",
    "run",
    "-d",
    "--name",
    database,
    "--network",
    networkName,
    "--env-file",
    postgresEnv,
    "postgres:18.4",
  ]);
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    const child = Bun.spawn(
      ["docker", "exec", database, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"],
      {
        stdout: "ignore",
        stderr: "ignore",
      },
    );
    if ((await child.exited) === 0) {
      ready = true;
      break;
    }
    await Bun.sleep(500);
  }
  assert.ok(ready, "Owned Postgres must become ready");
  const runtime = `postgresql://strata_app:${appPassword}@${database}:5432/docker_acceptance`;
  const common = {
    DATABASE_URL: runtime,
    APP_DATABASE_URL: runtime,
    APP_NAME: "Strata acceptance",
    APP_KEY_PREFIX: `docker_${id}`,
    APP_URL: "https://docker-acceptance.example.test",
    API_PREFIX: "/api",
    PORT: "3000",
    FRONTEND_MODE: "server-htmx",
    TENANCY_DRIVER: "rls",
    AUTH_DEV_HEADERS: "false",
    CACHE_DRIVER: "redis",
    QUEUE_DRIVER: "redis",
    MAIL_DRIVER: "log",
    REDIS_URL: `redis://:${redisPassword}@${redis}:6379`,
    SESSION_SECRET: session,
    TOKEN_HASH_PEPPER: pepper,
    API_TOKEN_DEFAULT_EXPIRY_DAYS: "30",
    KMS_ENCRYPTION_KEY: encryptionKey,
    JWT_SECRET: pepper,
    METRICS_TOKEN: metrics,
    FEATURE_METRICS: "true",
    FEATURE_MFA: "true",
    FEATURE_EMAIL_VERIFICATION: "true",
    FEATURE_SCIM: "false",
    FEATURE_SAML: "false",
    FEATURE_OAUTH: "false",
    FEATURE_BILLING: "false",
    FEATURE_REGISTRATION: "true",
  };
  const envText = (values: Record<string, string>) =>
    Object.entries(values)
      .map(([k, v]) => `${k}=${v}\n`)
      .join("");
  const migrateEnv = join(directory, "migrate.env"),
    runtimeEnv = join(directory, "runtime.env");
  const productionMigrationEnv = join(directory, "production-migration.env");
  await writeFile(
    migrateEnv,
    envText({
      ...common,
      APP_ENV: "local",
      NODE_ENV: "development",
      STRATA_APP_PASSWORD: appPassword,
      MIGRATION_DATABASE_URL: `postgresql://postgres:${adminPassword}@${database}:5432/postgres`,
    }),
    { mode: 0o600 },
  );
  await writeFile(runtimeEnv, envText({ ...common, APP_ENV: "production", APP_DEBUG: "false" }), {
    mode: 0o600,
  });
  await writeFile(
    productionMigrationEnv,
    envText({
      ...common,
      APP_ENV: "production",
      NODE_ENV: "production",
      STRATA_APP_PASSWORD: appPassword,
      MIGRATION_DATABASE_URL: `postgresql://postgres:${adminPassword}@${database}:5432/postgres`,
    }),
    { mode: 0o600 },
  );
  const cli = ["bun", "node_modules/@getstrata/cli/cli.ts"];
  const productionMigration = [
    "docker",
    "run",
    "--rm",
    "--name",
    migration,
    "--network",
    networkName,
    "--env-file",
    productionMigrationEnv,
    image,
    ...cli,
    "migrate",
  ];
  await run(productionMigration);
  const refusedSeed = await run([...productionMigration, "--seed"], 60000, 1);
  assert.match(refusedSeed, /Demo seeding is disabled in production and staging/);
  await run([
    "docker",
    "run",
    "--rm",
    "--name",
    migration,
    "--network",
    networkName,
    "--env-file",
    migrateEnv,
    image,
    ...cli,
    "migrate",
    "--seed",
  ]);
  await run([
    "docker",
    "run",
    "--rm",
    "--name",
    migration,
    "--network",
    networkName,
    "--env-file",
    migrateEnv,
    image,
    ...cli,
    "migrate",
  ]);
  await run([
    "docker",
    "run",
    "-d",
    "--name",
    server,
    "--network",
    networkName,
    "--env-file",
    runtimeEnv,
    "-p",
    "127.0.0.1::3000",
    image,
  ]);
  const binding = JSON.parse(
    await run([
      "docker",
      "inspect",
      server,
      "--format",
      '{{json (index .NetworkSettings.Ports "3000/tcp")}}',
    ]),
  );
  const port = binding[0]?.HostPort;
  assert.ok(port, "Docker must publish its actual HTTP port");
  const base = `http://127.0.0.1:${port}`;
  ready = false;
  let lastReadiness = "";
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(`${base}/ready`, { signal: AbortSignal.timeout(1000) });
      lastReadiness = `${response.status}: ${await response.text()}`;
      if (response.ok) {
        ready = true;
        break;
      }
    } catch (error) {
      lastReadiness = error instanceof Error ? error.message : String(error);
    }
    const running = await run(["docker", "inspect", server, "--format", "{{.State.Running}}"]);
    if (running !== "true") break;
    await Bun.sleep(500);
  }
  if (!ready)
    throw new Error(
      `Production image did not become ready (${lastReadiness}): ${await run(["docker", "logs", server])}; health=${await run(["docker", "inspect", server, "--format", "{{json .State.Health}}"])}`,
    );
  // Production RLS accepts only the configured virtual host. Unknown and untrusted
  // forwarded hosts must stay denied, including through Docker's loopback port.
  assert.equal((await fetch(`${base}/login`, { signal: AbortSignal.timeout(5000) })).status, 403);
  assert.equal(
    (
      await fetch(`${base}/login`, {
        headers: { "x-forwarded-host": "docker-acceptance.example.test" },
        signal: AbortSignal.timeout(5000),
      })
    ).status,
    403,
  );
  // A loopback-only test edge supplies the approved authority without changing DNS,
  // generated tenant policy, the application, or either existing smoke script.
  edge = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      if (request.method !== "GET" && request.method !== "HEAD")
        return new Response(null, { status: 405 });
      const url = new URL(request.url);
      const headers = new Headers(request.headers);
      headers.set("host", "docker-acceptance.example.test");
      headers.delete("x-forwarded-host");
      return fetch(`${base}${url.pathname}${url.search}`, {
        method: request.method,
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(5000),
      });
    },
  });
  const publicBase = edge.url.toString().replace(/\/$/, "");
  for (const script of ["scripts/smoke-test.ts", "scripts/smoke-webview.ts"]) {
    const child = Bun.spawn(["bun", script], {
      cwd: root,
      env: { ...process.env, BASE_URL: publicBase, METRICS_TOKEN: metrics, APP_ENV: "production" },
      stdout: "inherit",
      stderr: "inherit",
      timeout: 60000,
      killSignal: "SIGTERM",
    });
    assert.equal(await child.exited, 0, `Unchanged ${script} must pass against Docker`);
  }
  assert.equal((await fetch(`${base}/metrics`, { signal: AbortSignal.timeout(5000) })).status, 404);
  assert.equal(
    (await fetch(`${publicBase}/api/v1/auth/csrf`, { signal: AbortSignal.timeout(5000) })).status,
    200,
  );
  const probe = await run([
    "docker",
    "exec",
    server,
    "bun",
    "-e",
    `
    if (process.env.MIGRATION_DATABASE_URL) throw new Error("HTTP inherited admin credentials");
    if (await Bun.file("/workspace/apps/hiroapp/package.json").exists() || await Bun.file("/app/apps/hiroapp/package.json").exists()) throw new Error("Legacy app copied into image");
    const db = new Bun.SQL(process.env.DATABASE_URL);
    console.log(JSON.stringify(await db.unsafe("SELECT rolname,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user")));
    await db.close();`,
  ]);
  assert.deepEqual(JSON.parse(probe), [
    { rolname: "strata_app", rolsuper: false, rolbypassrls: false },
  ]);
  await run(["docker", "stop", "--time", "5", redis]);
  assert.equal(
    (await fetch(`${base}/ready`, { signal: AbortSignal.timeout(5000) })).status,
    503,
    "A lost Redis dependency must fail readiness",
  );
  await run(["docker", "start", redis]);
  let recovered = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    const response = await fetch(`${base}/ready`, { signal: AbortSignal.timeout(5000) });
    if (response.status === 200) {
      recovered = true;
      break;
    }
    await Bun.sleep(500);
  }
  assert.ok(recovered, "Readiness must recover after owned Redis restarts");
  let healthy = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    if (
      (await run(["docker", "inspect", server, "--format", "{{.State.Health.Status}}"])) ===
      "healthy"
    ) {
      healthy = true;
      break;
    }
    await Bun.sleep(500);
  }
  assert.ok(healthy, "Docker HEALTHCHECK must execute successfully");
  await run(["docker", "stop", "--time", "15", server]);
  const state = JSON.parse(await run(["docker", "inspect", server, "--format", "{{json .State}}"]));
  assert.equal(state.ExitCode, 0, "Native CLI must drain and exit cleanly");
  assert.equal(state.OOMKilled, false);
  console.log(
    "Generated Docker acceptance passed: explicit migration/seed, production restricted-role boot, HTTP/metrics/CSRF and graceful shutdown.",
  );
} finally {
  edge?.stop(true);
  try {
    // Only resources named by this invocation are removed, including failed setup.
    await removeOwnedDockerContainers(run, [server, migration, database, redis]);
  } finally {
    try {
      const found = await run(["docker", "image", "ls", "-q", image]);
      if (found) await run(["docker", "image", "rm", "-f", image]);
    } finally {
      try {
        if (networkCreated) await run(["docker", "network", "rm", networkName]);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  }
}
