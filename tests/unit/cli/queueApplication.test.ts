import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppModule } from "@getstrata/bootstrap/contracts";
import { Job, type JobContext } from "@getstrata/core/queue";
import { FAILED_JOB_SERVICE_TOKEN } from "@getstrata/core/queue/createAppQueue";
import type { JobRegistry } from "@getstrata/core/queue/jobRegistry";
import type { QueueWorkerTransport } from "@getstrata/core/queue/queueWorkerTransport";
import { RedisClient } from "bun";
import { bootQueueApplication } from "../../../src/cli/commands/queueApplication";
import { bounded } from "../../fixtures/applicationOwnershipSupport";

type LiveApplication = Awaited<ReturnType<typeof bootQueueApplication>>;

/** Exercise the live monorepo assembly, without replacing providers or its database graph. */
async function liveWorkspace(
  work: (fixture: {
    filename: string;
    prefix: string;
    hooks: { registers: number; boots: number; closes: number };
    boot(worker?: boolean): Promise<LiveApplication>;
  }) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), "strata-live-queue-"));
  const filename = join(directory, "queue.sqlite");
  const originalCwd = process.cwd();
  const prefix = `queue-composition-${crypto.randomUUID()}`;
  const changes: Record<string, string | undefined> = {
    APP_ENV: "local",
    NODE_ENV: "test",
    FRONTEND_MODE: "api",
    TENANCY_DRIVER: "none",
    DATABASE_URL: `sqlite://${filename}`,
    APP_DATABASE_URL: `sqlite://${filename}`,
    DB_CONNECTION: "sqlite",
    CACHE_DRIVER: "array",
    QUEUE_DRIVER: "sync",
    QUEUE_REDIS_TRANSPORT: "streams",
    APP_KEY_PREFIX: prefix,
    REDIS_URL: process.env.REDIS_URL,
    OTEL_SDK_DISABLED: "true",
    FEATURE_SIEM_EXPORT: "false",
    SIEM_EXPORT_URL: undefined,
    SESSION_SECRET: "queue-composition-fixture-secret-32-characters",
    QUEUE_MAX_ATTEMPTS: "1",
    QUEUE_BACKOFF_MS: "0",
    QUEUE_VISIBILITY_MS: "1000",
  };
  const previous = Object.fromEntries(Object.keys(changes).map((key) => [key, process.env[key]]));
  const hooks = { registers: 0, boots: 0, closes: 0 };
  const applications: LiveApplication[] = [];
  let failure: unknown;
  try {
    await mkdir(join(directory, "src/jobs"), { recursive: true });
    process.chdir(directory);
    for (const [key, value] of Object.entries(changes))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    const modules: AppModule[] = [
      {
        name: "queue-composition-witness",
        providers: [
          {
            name: "queue-composition-provider",
            register({ onCleanup }) {
              hooks.registers++;
              onCleanup(() => {
                hooks.closes++;
              });
            },
            boot() {
              hooks.boots++;
            },
          },
        ],
      },
    ];
    await work({
      filename,
      prefix,
      hooks,
      boot: async (worker = false) => {
        const application = await bootQueueApplication(worker, { modules });
        applications.push(application);
        return application;
      },
    });
  } catch (error) {
    failure = error;
  }
  const errors: unknown[] = failure === undefined ? [] : [failure];
  for (const app of applications.reverse()) {
    try {
      const result = await app.application.stop();
      if (!result.successful)
        throw new Error("Live queue application cleanup did not settle cleanly");
    } catch (error) {
      errors.push(error);
    }
  }
  try {
    process.chdir(originalCwd);
    for (const [key, value] of Object.entries(previous))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    await rm(directory, { recursive: true, force: true });
  } catch (error) {
    errors.push(error);
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length)
    throw new AggregateError(errors, "Live queue operation and owned cleanup failed");
}

async function schema(app: LiveApplication) {
  await app.invoke({ kind: "command" }, async ({ database }) => {
    await database.execute({
      text: "CREATE TABLE failed_job(id INTEGER PRIMARY KEY,job_name TEXT NOT NULL,job_id TEXT,payload TEXT NOT NULL,exception TEXT NOT NULL,failed_at DATETIME NOT NULL)",
      params: [],
    });
    await database.execute({ text: "CREATE TABLE queue_effects(id INTEGER NOT NULL)", params: [] });
  });
}
function nativeEffects(filename: string) {
  const database = new Database(filename, { readonly: true });
  try {
    return database.query("SELECT id FROM queue_effects ORDER BY id").all();
  } finally {
    database.close();
  }
}
function liveJob(name: string, contexts: JobContext[], registry: JobRegistry) {
  class CompositionJob extends Job<{ id: number; fail?: boolean }> {
    static override readonly jobName = name;
    override readonly maxAttempts = 1;
    override async handle(payload: { id: number; fail?: boolean }, context?: JobContext) {
      if (!context?.database)
        throw new Error("Composition job must receive its selected application database");
      contexts.push(context);
      if (payload.fail) throw new Error("queue composition failure sentinel");
      await context.database.execute({
        text: "INSERT INTO queue_effects VALUES (?)",
        params: [payload.id],
      });
    }
  }
  registry.register(name, () => new CompositionJob());
  return CompositionJob;
}

for (const mode of ["missing-database", "unsupported-driver", "missing-worker-redis"] as const) {
  test(`live queue assembly rejects ${mode} before provider/native acquisition`, async () => {
    await liveWorkspace(async ({ boot, hooks, filename }) => {
      if (mode === "missing-database") delete process.env.DATABASE_URL;
      if (mode === "unsupported-driver") process.env.DB_CONNECTION = "unsupported";
      if (mode === "missing-worker-redis") delete process.env.REDIS_URL;
      await expect(boot(mode === "missing-worker-redis")).rejects.toThrow(
        mode === "missing-database"
          ? "Queue commands require DATABASE_URL."
          : mode === "unsupported-driver"
            ? "Unsupported queue database driver."
            : "queue:work requires REDIS_URL to be set.",
      );
      expect(hooks).toEqual({ registers: 0, boots: 0, closes: 0 });
      expect(existsSync(filename)).toBe(false);
    });
  });
}

test("live SQLite queue assembly owns genuine selected failed-job operations, replay and one settled stop", async () => {
  await liveWorkspace(async ({ boot, hooks, filename, prefix }) => {
    delete process.env.DB_CONNECTION; // Exercise the actual SQLite URL inference, not a test-selected pool.
    const app = await boot();
    expect(app.application).toBe(app.context.application);
    expect(app.invoke).toBe(app.context.invoke);
    expect(app.worker).toBeUndefined();
    expect(hooks).toEqual({ registers: 1, boots: 1, closes: 0 });
    expect(app.queueServices).toBe(app.context.container.get(FAILED_JOB_SERVICE_TOKEN));
    await schema(app);
    const contexts: JobContext[] = [];
    const CompositionJob = liveJob(`${prefix}.recovery`, contexts, app.registry);
    const failed = await app.queueServices.recordFailure({
      jobName: CompositionJob.jobName,
      payload: { id: 7 },
      exception: "recorded fixture failure",
    });
    const listed = await app.queueServices.listRecent();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.payload).toEqual({ id: 7 });
    const replayed = await app.queueServices.retry(failed.id, async (row) => {
      expect(row.id).toBe(failed.id);
      expect(row.payload).toEqual({ id: 7 });
      await app.queue.dispatch(new CompositionJob(), { id: 7 });
    });
    expect(replayed.id).toBe(failed.id);
    expect(await app.queueServices.listRecent()).toEqual([]);
    expect(nativeEffects(filename)).toEqual([{ id: 7 }]);
    expect(contexts).toHaveLength(1);
    const selected = contexts[0]?.database;
    if (!selected) throw new Error("Actual job did not receive selected SQL");
    await expect(
      selected.execute({ text: "INSERT INTO queue_effects VALUES (99)", params: [] }),
    ).rejects.toThrow();
    const held = await app.queueServices.recordFailure({
      jobName: CompositionJob.jobName,
      payload: { id: 8 },
      exception: "retain until admission",
    });
    const refusal = new Error("replay admission refused");
    await expect(
      app.queueServices.retry(held.id, async () => {
        throw refusal;
      }),
    ).rejects.toBe(refusal);
    expect((await app.queueServices.listRecent())[0]?.id).toBe(held.id);
    await app.queueServices.delete(held.id);
    expect(await app.queueServices.listRecent()).toEqual([]);
    for (const id of [9, 10])
      await app.queueServices.recordFailure({
        jobName: CompositionJob.jobName,
        payload: { id },
        exception: "flush fixture",
      });
    expect(await app.queueServices.flush()).toBe(2);
    expect(await app.queueServices.listRecent()).toEqual([]);
    expect(nativeEffects(filename)).toEqual([{ id: 7 }]);
    const result = await app.application.stop();
    expect(result.successful).toBe(true);
    expect(result.snapshot.retainedResources).toEqual([]);
    expect(hooks.closes).toBe(1);
    expect(await app.application.stop()).toBe(result);
    await app.context.dispose();
    expect(hooks.closes).toBe(1);
    await expect(app.queueServices.listRecent()).rejects.toThrow("APPLICATION_NOT_READY");
  });
});

async function ownedRedisKeys(client: RedisClient, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor = "0";
  for (let scans = 0; scans < 1000; scans++) {
    const result = await client.send("SCAN", [cursor, "MATCH", `${prefix}:*`, "COUNT", "100"]);
    if (!Array.isArray(result) || typeof result[0] !== "string" || !Array.isArray(result[1]))
      throw new Error("Invalid owned Redis SCAN result");
    cursor = result[0];
    for (const key of result[1]) {
      if (typeof key !== "string" || !key.startsWith(`${prefix}:`))
        throw new Error("Redis key escaped fixture namespace");
      keys.push(key);
    }
    if (cursor === "0") return [...new Set(keys)];
  }
  throw new Error("Owned Redis SCAN did not settle within its finite budget");
}

test("live Redis worker performs bounded isolated polls and selected SQLite failure recovery before owned shutdown", async () => {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error("Existing owned Redis fixture is required");
  await liveWorkspace(async ({ boot, hooks, filename, prefix }) => {
    process.env.QUEUE_DRIVER = "redis";
    const client = new RedisClient(redisUrl);
    let app: LiveApplication | undefined;
    let failure: unknown;
    try {
      expect(await ownedRedisKeys(client, prefix)).toEqual([]);
      app = await boot(true);
      await schema(app);
      const actual = app.worker;
      if (!actual || !("processNext" in actual) || typeof actual.processNext !== "function")
        throw new Error("Original application-owned worker lacks bounded polling");
      const worker = actual as QueueWorkerTransport;
      const contexts: JobContext[] = [];
      const CompositionJob = liveJob(`${prefix}.native`, contexts, app.registry);
      const foreign = `${prefix}:foreign:queue:default:stream`;
      await client.send("XADD", [
        foreign,
        "*",
        "payload",
        JSON.stringify({ name: CompositionJob.jobName, payload: { id: 99 }, attempts: 0 }),
      ]);
      await app.queue.dispatch(new CompositionJob(), { id: 1 });
      expect(await bounded(worker.processNext(), "native bounded Redis job")).toBe(true);
      expect(nativeEffects(filename)).toEqual([{ id: 1 }]);
      await app.queue.dispatch(new CompositionJob(), { id: 2, fail: true });
      expect(await bounded(worker.processNext(), "native bounded Redis failure")).toBe(true);
      const failures = await app.queueServices.listRecent();
      expect(failures).toHaveLength(1);
      const failed = failures[0];
      if (!failed?.job_id) throw new Error("Native worker did not preserve failed job identity");
      expect(failed.exception).toContain("queue composition failure sentinel");
      expect(failed.payload).toEqual({ id: 2, fail: true });
      expect(failed.job_id.startsWith(`${prefix}:queue:default:stream/`)).toBe(true);
      const queue = app.queue;
      if (!queue.replay) throw new Error("Actual Streams queue lacks identity replay");
      const replay = queue.replay.bind(queue);
      const identity = failed.job_id;
      await app.queueServices.retry(failed.id, async (row) => {
        expect(row.job_id).toBe(failed.job_id);
        await replay(new CompositionJob(), { id: 2 }, identity);
      });
      expect(await bounded(worker.processNext(), "native recovered Redis job")).toBe(true);
      expect(await app.queueServices.listRecent()).toEqual([]);
      expect(nativeEffects(filename)).toEqual([{ id: 1 }, { id: 2 }]);
      expect(contexts).toHaveLength(3);
      expect(contexts[2]?.jobId).toBe(failed.job_id);
      expect(await client.send("XLEN", [foreign])).toBe(1);
      const stopped = await app.application.stop();
      expect(stopped.successful).toBe(true);
      expect(stopped.snapshot.retainedResources).toEqual([]);
      expect(hooks.closes).toBe(1);
      expect(await app.application.stop()).toBe(stopped);
      await expect(worker.processNext()).rejects.toThrow("bounded admission");
      await expect(worker.start()).rejects.toThrow("not available for admission");
      expect(await client.send("XLEN", [foreign])).toBe(1);
    } catch (error) {
      failure = error;
    }
    const cleanupErrors: unknown[] = failure === undefined ? [] : [failure];
    try {
      if (app && !(await app.application.stop()).successful)
        throw new Error("Live Redis queue application did not stop cleanly");
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      const keys = await ownedRedisKeys(client, prefix);
      if (keys.length) await client.send("DEL", keys);
      expect(await ownedRedisKeys(client, prefix)).toEqual([]);
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      client.close();
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (cleanupErrors.length === 1) throw cleanupErrors[0];
    if (cleanupErrors.length)
      throw new AggregateError(
        cleanupErrors,
        "Live Redis queue operation and owned cleanup failed",
      );
  });
});

for (const alias of ["postgresql", "mariadb"] as const) {
  test(`live ${alias} driver alias boots its original native pool for read-only selection and owned stop`, async () => {
    const url =
      alias === "postgresql"
        ? (process.env.RLS_TEST_DATABASE_URL ?? process.env.APP_DATABASE_URL)
        : (process.env.MYSQL_OBSERVABILITY_ADMIN_URL ?? process.env.MYSQL_URL);
    if (!url) throw new Error(`Existing owned ${alias} fixture is required`);
    await liveWorkspace(async ({ boot, hooks, filename }) => {
      process.env.DATABASE_URL = url;
      process.env.APP_DATABASE_URL = url;
      process.env.DB_CONNECTION = alias;
      const app = await boot();
      expect(hooks).toEqual({ registers: 1, boots: 1, closes: 0 });
      const result = await app.invoke({ kind: "command" }, async ({ database }) => ({
        driver: database.dialect.driver,
        rows: await database.execute<{ value: number }>({ text: "SELECT 1 AS value", params: [] }),
      }));
      expect(result).toEqual({
        driver: alias === "postgresql" ? "pgsql" : "mysql",
        rows: [{ value: 1 }],
      });
      expect(existsSync(filename)).toBe(false);
      const stopped = await app.application.stop();
      expect(stopped.successful).toBe(true);
      expect(stopped.snapshot.retainedResources).toEqual([]);
      expect(await app.application.stop()).toBe(stopped);
      expect(hooks.closes).toBe(1);
      // The MySQL fixture may be administrative: this is a native read/ownership
      // witness, not a runtime restricted-role or privilege assertion.
    });
  });
}

test("live queue assembly rejects SQLite filename or foreign scheme before native acquisition and recovers with sqlite: URL", async () => {
  await liveWorkspace(async ({ boot, hooks, filename }) => {
    process.env.DB_CONNECTION = "sqlite";
    for (const url of [filename, "postgresql://unused.invalid/not-sqlite"]) {
      process.env.DATABASE_URL = url;
      process.env.APP_DATABASE_URL = url;
      await expect(boot()).rejects.toThrow("SQLite queue commands require a sqlite: DATABASE_URL.");
      expect(hooks).toEqual({ registers: 0, boots: 0, closes: 0 });
      expect(existsSync(filename)).toBe(false);
    }
    process.env.DATABASE_URL = `sqlite:${filename}`;
    process.env.APP_DATABASE_URL = `sqlite:${filename}`;
    const app = await boot();
    expect(hooks).toEqual({ registers: 1, boots: 1, closes: 0 });
    expect(
      await app.invoke({ kind: "command" }, async ({ database }) => ({
        driver: database.dialect.driver,
        rows: [...(await database.execute({ text: "SELECT 101 AS value", params: [] }))],
      })),
    ).toEqual({ driver: "sqlite", rows: [{ value: 101 }] });
    expect(existsSync(filename)).toBe(true);
    const stopped = await app.application.stop();
    expect(stopped.successful).toBe(true);
    expect(stopped.snapshot.retainedResources).toEqual([]);
    expect(await app.application.stop()).toBe(stopped);
    expect(hooks.closes).toBe(1);
  });
});
