import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SQL } from "bun";
import { removeOwnedDockerContainers } from "../tests/helpers/ownedDockerContainers";
import { WORKER_ENVIRONMENT_KEYS } from "../tests/helpers/testWorkerEnvironment";
import { collectSpawnOutput } from "./bun-test-output";

const ROOT = resolve(import.meta.dir, "..");
const PASSWORD = "dev-postgres-change-me";
const APP_PASSWORD = "dev-strata-app-change-me";
const commands = new Set<ReturnType<typeof Bun.spawn>>();

function testWorkerCount(raw = process.env.STRATA_TEST_WORKERS ?? "2"): number {
  assert.match(raw, /^[1-4]$/, "STRATA_TEST_WORKERS must be 1, 2, 3 or 4");
  return Number(raw);
}

async function command(args: string[], env = process.env): Promise<string> {
  const child = Bun.spawn(args, {
    cwd: ROOT,
    env,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 120000,
  });
  commands.add(child);
  try {
    const result = await collectSpawnOutput(child);
    assert.equal(result.exitCode, 0, `${args[0]} ${args[1]} failed: ${result.output}`);
    return result.output.trim();
  } finally {
    commands.delete(child);
  }
}

/** Worker 1 retains the existing fixtures; only additional workers own disposable services. */
async function withTestWorkers<T>(
  count: number,
  work: (env: NodeJS.ProcessEnv) => Promise<T>,
): Promise<T> {
  assert.ok(Number.isInteger(count) && count >= 1 && count <= 4);
  if (count === 1) return work(process.env);
  const workers: Record<string, Record<string, string>> = {};
  const primary: Record<string, string> = {};
  for (const key of WORKER_ENVIRONMENT_KEYS) {
    const value =
      key === "RLS_TEST_DATABASE_URL"
        ? (process.env.RLS_TEST_DATABASE_URL ?? process.env.APP_DATABASE_URL)
        : process.env[key];
    if ((key === "POSTGRES_PASSWORD" || key === "STRATA_APP_PASSWORD") && value === undefined)
      continue;
    assert.ok(value, `${key} is required before parallel tests`);
    primary[key] = value;
  }
  workers["1"] = primary;
  const compose = Bun.YAML.parse(await Bun.file(join(ROOT, "docker-compose.yml")).text()) as {
    services: Record<"postgres" | "mysql" | "redis", { image: string }>;
  };
  const images = {
    postgres: process.env.STRATA_TEST_POSTGRES_IMAGE ?? compose.services.postgres.image,
    mysql: compose.services.mysql.image,
    redis: compose.services.redis.image,
  };
  const primarySql = new SQL({ url: primary.MIGRATION_DATABASE_URL, max: 1 });
  let primaryVersion: number;
  try {
    const [row] = await primarySql.unsafe<{ version: number }[]>(
      "SELECT current_setting('server_version_num')::int AS version",
    );
    assert.ok(row);
    primaryVersion = row.version;
  } finally {
    await primarySql.close();
  }
  const directory = await mkdtemp(join(tmpdir(), "strata-test-workers-"));
  const owner = `strata-workers-${crypto.randomUUID()}`;
  const names: string[] = [];
  let interrupted = false;
  const interrupt = () => {
    interrupted = true;
    for (const child of commands) child.kill("SIGTERM");
  };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  async function create(worker: number, service: "postgres" | "mysql" | "redis") {
    assert.ok(!interrupted, "Worker preparation interrupted");
    const name = `${owner}-${worker}-${service}`;
    const port = service === "postgres" ? 5432 : service === "mysql" ? 3306 : 6379;
    const args = [
      "docker",
      "run",
      "-d",
      "--name",
      name,
      "--label",
      `strata.test-owner=${owner}`,
      "-p",
      `127.0.0.1::${port}`,
    ];
    if (service === "postgres") args.push("-e", `POSTGRES_PASSWORD=${PASSWORD}`, images.postgres);
    if (service === "mysql")
      args.push(
        "-e",
        "MYSQL_ROOT_PASSWORD=dev-mysql-change-me",
        "-e",
        "MYSQL_DATABASE=strata",
        "-e",
        "MYSQL_USER=strata",
        "-e",
        "MYSQL_PASSWORD=dev-mysql-change-me",
        images.mysql,
      );
    if (service === "redis")
      args.push(images.redis, "redis-server", "--requirepass", "dev-redis-change-me");
    await command(args);
    const bindings = JSON.parse(
      await command(["docker", "inspect", name, "--format", "{{json .NetworkSettings.Ports}}"]),
    );
    const hostPort: unknown = bindings[`${port}/tcp`]?.[0]?.HostPort;
    assert.ok(typeof hostPort === "string" && /^\d+$/.test(hostPort));
    const ready =
      service === "postgres"
        ? [
            "docker",
            "exec",
            "-e",
            `PGPASSWORD=${PASSWORD}`,
            name,
            "psql",
            "-h",
            "127.0.0.1",
            "-U",
            "postgres",
            "-d",
            "postgres",
            "-Atc",
            "SELECT 1",
          ]
        : service === "mysql"
          ? [
              "docker",
              "exec",
              "-e",
              "MYSQL_PWD=dev-mysql-change-me",
              name,
              "mysql",
              "-h",
              "127.0.0.1",
              "-uroot",
              "-Nse",
              "SELECT 1",
            ]
          : [
              "docker",
              "exec",
              "-e",
              "REDISCLI_AUTH=dev-redis-change-me",
              name,
              "redis-cli",
              "ping",
            ];
    let last: unknown;
    for (let attempt = 0; attempt < 120; attempt++) {
      try {
        const answer = await command(ready);
        assert.ok(answer.endsWith(service === "redis" ? "PONG" : "1"));
        return hostPort;
      } catch (error) {
        if (interrupted) throw error;
        last = error;
        await Bun.sleep(500);
      }
    }
    throw new Error(`Isolated worker ${worker} ${service} did not become ready`, { cause: last });
  }
  const failures: unknown[] = [];
  let result: { value: T } | undefined;
  try {
    for (let worker = 2; worker <= count; worker++) {
      assert.ok(!interrupted, "Worker preparation interrupted");
      // Receipt the whole planned set before any concurrent Docker command can create it.
      names.push(
        ...["postgres", "mysql", "redis"].map((service) => `${owner}-${worker}-${service}`),
      );
      await writeFile(join(directory, "ownership.json"), JSON.stringify({ owner, names }));
      // Wait for every started service even if one fails, before any cleanup begins.
      const results = await Promise.allSettled([
        create(worker, "postgres"),
        create(worker, "mysql"),
        create(worker, "redis"),
      ]);
      const ports = results.map((result) => {
        if (result.status === "rejected") throw result.reason;
        return result.value;
      });
      const [postgres, mysql, redis] = ports;
      assert.ok(postgres && mysql && redis);
      const sql = new SQL(`postgresql://postgres:${PASSWORD}@127.0.0.1:${postgres}/postgres`);
      try {
        const [row] = await sql.unsafe<{ version: number }[]>(
          "SELECT current_setting('server_version_num')::int AS version",
        );
        assert.equal(
          row?.version,
          primaryVersion,
          "Worker PostgreSQL must match the primary fixture; configure STRATA_TEST_POSTGRES_IMAGE for a custom primary image",
        );
        await sql.unsafe(
          `CREATE ROLE strata_app LOGIN PASSWORD '${APP_PASSWORD}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`,
        );
        await sql.unsafe("CREATE DATABASE bun_testing_test");
        await sql.unsafe("CREATE DATABASE hiroapp_test");
      } finally {
        await sql.close();
      }
      workers[String(worker)] = {
        DATABASE_URL: `postgresql://postgres:${PASSWORD}@127.0.0.1:${postgres}/bun_testing_test`,
        MIGRATION_DATABASE_URL: `postgresql://postgres:${PASSWORD}@127.0.0.1:${postgres}/hiroapp_test`,
        APP_DATABASE_URL: `postgresql://strata_app:${APP_PASSWORD}@127.0.0.1:${postgres}/hiroapp_test`,
        RLS_TEST_DATABASE_URL: `postgresql://strata_app:${APP_PASSWORD}@127.0.0.1:${postgres}/hiroapp_test`,
        REDIS_URL: `redis://:dev-redis-change-me@127.0.0.1:${redis}`,
        MYSQL_URL: `mysql://strata:dev-mysql-change-me@127.0.0.1:${mysql}/strata`,
        MYSQL_OBSERVABILITY_ADMIN_URL: `mysql://root:dev-mysql-change-me@127.0.0.1:${mysql}/mysql`,
        POSTGRES_PASSWORD: PASSWORD,
        STRATA_APP_PASSWORD: APP_PASSWORD,
      };
      await command([process.execPath, "src/cli/index.ts", "migrate:fresh", "--seed"], {
        ...process.env,
        ...workers[String(worker)],
        POSTGRES_PASSWORD: PASSWORD,
        STRATA_APP_PASSWORD: APP_PASSWORD,
        STRATA_SCHEMA: "fixture",
        SKIP_FIXTURE_TEST_BOOTSTRAP: "1",
      });
    }
    const file = join(directory, "environments.json");
    await writeFile(file, JSON.stringify({ version: 1, workers }), { mode: 0o600 });
    assert.ok(!interrupted, "Worker preparation interrupted");
    result = { value: await work({ ...process.env, STRATA_TEST_WORKER_ENV_FILE: file }) };
  } catch (error) {
    failures.push(error);
  } finally {
    const owned: string[] = [];
    const errors: unknown[] = [];
    for (const name of names) {
      try {
        const id = await command([
          "docker",
          "ps",
          "-aq",
          "--filter",
          `name=^/${name}$`,
          "--filter",
          `label=strata.test-owner=${owner}`,
        ]);
        if (id) owned.push(name);
      } catch (error) {
        errors.push(error);
      }
    }
    try {
      await removeOwnedDockerContainers(command, owned);
    } catch (error) {
      errors.push(error);
    }
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
    if (errors.length === 0) {
      try {
        await rm(directory, { recursive: true, force: true });
      } catch (error) {
        errors.push(error);
      }
    }
    failures.push(...errors);
  }
  if (failures.length)
    throw new AggregateError(
      failures,
      `Test worker execution/cleanup failed; ownership receipt on cleanup failure: ${directory}`,
    );
  assert.ok(result);
  return result.value;
}

export { testWorkerCount, withTestWorkers };
