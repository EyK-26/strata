import { afterEach, describe, expect, mock, test } from "bun:test";
import * as createAppQueueModule from "@getstrata/core/queue/createAppQueue";
import { restoreEnvVar } from "../../helpers/restoreEnv";

afterEach(() => {
  mock.restore();
});

describe("runQueueWorkerCommand", () => {
  test("requires REDIS_URL", async () => {
    const previousRedisUrl = process.env.REDIS_URL;
    delete process.env.REDIS_URL;

    const previousAppEnv = process.env.APP_ENV;
    process.env.APP_ENV = "local";

    try {
      const { runQueueWorkerCommand } = await import(
        "../../../packages/strata-cli/src/queueWorker.ts"
      );
      await expect(runQueueWorkerCommand({ boot: () => undefined })).rejects.toThrow(
        "queue:work requires REDIS_URL to be set.",
      );
    } finally {
      restoreEnvVar("APP_ENV", previousAppEnv);
      if (previousRedisUrl === undefined) {
        delete process.env.REDIS_URL;
      } else {
        restoreEnvVar("REDIS_URL", previousRedisUrl);
      }
    }
  });

  test("runs boot before the worker starts consuming jobs", async () => {
    const previousRedisUrl = process.env.REDIS_URL;
    process.env.REDIS_URL = "redis://localhost:6379";

    let bootFinished = false;
    let workerRunStarted = false;

    const previousAppEnv = process.env.APP_ENV;
    process.env.APP_ENV = "local";

    mock.module("@getstrata/core/lifecycle/gracefulShutdown", () => ({
      installGracefulShutdownSignals: () => undefined,
      registerShutdownHandler: () => undefined,
    }));
    mock.module("@getstrata/core/queue/createAppQueue", () => ({
      ...createAppQueueModule,
      createFailedJobService: () => ({}),
      createQueueWorker: () => ({
        run: async () => {
          workerRunStarted = true;
          expect(bootFinished).toBe(true);
        },
        requestStop: () => undefined,
      }),
    }));

    try {
      const { runQueueWorkerCommand } = await import(
        "../../../packages/strata-cli/src/queueWorker.ts"
      );
      await runQueueWorkerCommand({
        async boot() {
          expect(workerRunStarted).toBe(false);
          bootFinished = true;
        },
      });
      expect(workerRunStarted).toBe(true);
    } finally {
      restoreEnvVar("APP_ENV", previousAppEnv);
      if (previousRedisUrl === undefined) {
        delete process.env.REDIS_URL;
      } else {
        restoreEnvVar("REDIS_URL", previousRedisUrl);
      }
    }
  });
});
