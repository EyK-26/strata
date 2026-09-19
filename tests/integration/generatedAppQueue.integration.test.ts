import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Job } from "@getstrata/core/queue";
import { createFailedJobService } from "@getstrata/core/queue/createAppQueue";
import { jobRegistry } from "@getstrata/core/queue/jobRegistry";
import { type QueueJobEnvelope, runQueueJob } from "@getstrata/core/queue/jobRunner";
import { QUEUE_LIST_KEY, RedisQueue } from "@getstrata/core/queue/redisQueue";
import { RedisClient } from "bun";
import { resetDiscoverModulesForUnitTests } from "../helpers/discoverModulesTest.ts";
import {
  applyGeneratedAppSqliteEnv,
  generateAndInstallApp,
  repoRoot,
} from "../helpers/generatedAppHarness";
import { restoreEnvVar } from "../helpers/restoreEnv";

const INTEGRATION_ENV_KEYS = [
  "DATABASE_URL",
  "APP_ENV",
  "FRONTEND_MODE",
  "AUTH_DEV_HEADERS",
  "TENANCY_DRIVER",
  "QUEUE_DRIVER",
  "REDIS_URL",
] as const;

interface EchoPayload {
  message: string;
}

const cleanups: Array<() => Promise<void>> = [];
let savedIntegrationEnv: Record<string, string | undefined> | undefined;

afterEach(async () => {
  process.chdir(repoRoot);
  resetDiscoverModulesForUnitTests();
  if (savedIntegrationEnv) {
    for (const key of INTEGRATION_ENV_KEYS) {
      restoreEnvVar(key, savedIntegrationEnv[key]);
    }
    savedIntegrationEnv = undefined;
  }
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    if (cleanup) {
      await cleanup();
    }
  }
});

describe("generated app queue integration", () => {
  test("bootstrapApp registers jobs and redis dispatch runs after boot", async () => {
    const redisUrl = `${process.env.REDIS_URL ?? "redis://:dev-redis-change-me@127.0.0.1:6379"}/15`;
    const { app, cleanup } = await generateAndInstallApp("queue-redis");
    cleanups.push(cleanup);

    const previousCwd = process.cwd();
    savedIntegrationEnv = Object.fromEntries(
      INTEGRATION_ENV_KEYS.map((key) => [key, process.env[key]]),
    );
    applyGeneratedAppSqliteEnv();
    process.env.REDIS_URL = redisUrl;
    resetDiscoverModulesForUnitTests();

    try {
      process.chdir(app);
      const { bootstrapApp } = await import(join(app, "src/bootstrap/createApp.ts"));
      const { closeDatabase } = await import(join(app, "src/bootstrap/database.ts"));

      await bootstrapApp({ migrate: false });

      const messages: string[] = [];
      class EchoJob extends Job<EchoPayload> {
        override async handle(payload: EchoPayload): Promise<void> {
          messages.push(payload.message);
        }
      }

      const echoJob = new EchoJob();
      jobRegistry.register("generated.echo.integration", () => echoJob);
      jobRegistry.track("generated.echo.integration", echoJob);

      const queue = new RedisQueue(redisUrl);
      const client = new RedisClient(redisUrl);
      const failedJobs = createFailedJobService();

      await client.del(QUEUE_LIST_KEY);
      await queue.dispatch(echoJob, { message: "generated-app-redis" });

      const popped = await client.brpop(QUEUE_LIST_KEY, 2);
      expect(popped).not.toBeNull();

      const [, rawPayload] = popped as [string, string];
      const envelope = JSON.parse(rawPayload) as QueueJobEnvelope;
      await runQueueJob(envelope, failedJobs);

      expect(messages).toEqual(["generated-app-redis"]);
      await closeDatabase();
    } finally {
      process.chdir(previousCwd);
    }
  }, 120_000);
});
