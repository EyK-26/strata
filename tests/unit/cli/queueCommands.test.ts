import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  resetGracefulShutdownForTests,
  runGracefulShutdown,
} from "../../../src/core/lifecycle/gracefulShutdown";
import { Job } from "../../../src/core/queue";
import { captureConsole } from "./helpers";

afterEach(async () => {
  mock.restore();
  resetGracefulShutdownForTests();
  const { restoreDefaultDatabaseConnection } = await import("../testHelpers");
  await restoreDefaultDatabaseConnection();
});

describe("queueWorkCommand", () => {
  test("requires REDIS_URL", async () => {
    const previousRedisUrl = process.env.REDIS_URL;
    delete process.env.REDIS_URL;

    try {
      const { queueWorkCommand } = await import("../../../src/cli/commands/queueWork");
      await expect(queueWorkCommand()).rejects.toThrow("queue:work requires REDIS_URL to be set.");
    } finally {
      if (previousRedisUrl === undefined) {
        delete process.env.REDIS_URL;
      } else {
        process.env.REDIS_URL = previousRedisUrl;
      }
    }
  });

  test("starts the queue worker and drains on shutdown", async () => {
    const previousRedisUrl = process.env.REDIS_URL;
    process.env.REDIS_URL = "redis://localhost:6379";

    let workerStarted = false;
    let workerStopped = false;

    mock.module("../../../src/core/queue/createAppQueue", () => ({
      createFailedJobService: () => ({}),
      createQueueWorker: () => ({
        run: async () => {
          workerStarted = true;
        },
        requestStop: () => {
          workerStopped = true;
        },
      }),
      registerDefaultJobs: () => undefined,
    }));
    mock.module("../../../src/db/connection", () => ({
      closeDatabase: async () => undefined,
    }));

    const { queueWorkCommand } = await import("../../../src/cli/commands/queueWork");
    const output = captureConsole();

    try {
      await queueWorkCommand();
    } finally {
      output.restore();
      if (previousRedisUrl === undefined) {
        delete process.env.REDIS_URL;
      } else {
        process.env.REDIS_URL = previousRedisUrl;
      }
    }

    expect(workerStarted).toBe(true);
    expect(
      output.logs.some((line) => line.includes("[queue:work] Listening for jobs on Redis")),
    ).toBe(true);
    expect(output.logs.some((line) => line.includes("[queue:work] Worker stopped."))).toBe(true);

    await runGracefulShutdown("TEST");
    expect(workerStopped).toBe(true);
  });
});

describe("queueFailedCommand", () => {
  test("prints a message when there are no failed jobs", async () => {
    mock.module("../../../src/core/queue/createAppQueue", () => ({
      createFailedJobService: () => ({
        listRecent: async () => [],
      }),
    }));

    const { queueFailedCommand } = await import("../../../src/cli/commands/queueFailed");
    const output = captureConsole();

    try {
      await queueFailedCommand();
    } finally {
      output.restore();
    }

    expect(output.logs).toEqual(["No failed jobs."]);
  });

  test("lists recent failed jobs", async () => {
    mock.module("../../../src/core/queue/createAppQueue", () => ({
      createFailedJobService: () => ({
        listRecent: async () => [
          {
            id: 7,
            job_name: "webhooks.dispatch",
            failed_at: new Date("2026-01-01T00:00:00.000Z"),
          },
        ],
      }),
    }));

    const { queueFailedCommand } = await import("../../../src/cli/commands/queueFailed");
    const output = captureConsole();

    try {
      await queueFailedCommand();
    } finally {
      output.restore();
    }

    expect(output.logs[0]).toBe("#7 webhooks.dispatch failed at 2026-01-01T00:00:00.000Z");
  });
});

describe("queueRetryCommand", () => {
  test("requires a failed job id", async () => {
    const { queueRetryCommand } = await import("../../../src/cli/commands/queueFailed");

    await expect(queueRetryCommand()).rejects.toThrow("queue:retry requires a failed job id.");
  });

  test("retries a failed job through the queue runner", async () => {
    class RetryJob extends Job<{ marker: string }> {
      override async handle(): Promise<void> {
        return;
      }
    }

    const failedJob = {
      id: 3,
      job_name: "test.retry",
      payload: { marker: "retry-me" },
      exception: "boom",
      failed_at: new Date(),
    };

    let runCalled = false;

    const { jobRegistry } = await import("../../../src/core/queue/jobRegistry");
    jobRegistry.register("test.retry", () => new RetryJob());

    mock.module("../../../src/core/queue/createAppQueue", () => ({
      createFailedJobService: () => ({
        retry: async () => failedJob,
      }),
    }));
    mock.module("../../../src/core/queue/jobRunner", () => ({
      runQueueJob: async () => {
        runCalled = true;
      },
    }));

    const { queueRetryCommand } = await import("../../../src/cli/commands/queueFailed");
    const output = captureConsole();

    try {
      await queueRetryCommand("3");
    } finally {
      output.restore();
    }

    expect(runCalled).toBe(true);
    expect(output.logs[0]).toBe("Retried failed job #3.");
  });

  test("rejects unknown job names", async () => {
    mock.module("../../../src/core/queue/createAppQueue", () => ({
      createFailedJobService: () => ({
        retry: async () => ({
          id: 1,
          job_name: "missing.job",
          payload: {},
          exception: "boom",
          failed_at: new Date(),
        }),
      }),
    }));

    const { queueRetryCommand } = await import("../../../src/cli/commands/queueFailed");

    await expect(queueRetryCommand("1")).rejects.toThrow('Unknown job "missing.job".');
  });
});

describe("queueFlushFailedCommand", () => {
  test("reports how many failed jobs were removed", async () => {
    mock.module("../../../src/core/queue/createAppQueue", () => ({
      createFailedJobService: () => ({
        flush: async () => 2,
      }),
    }));

    const { queueFlushFailedCommand } = await import("../../../src/cli/commands/queueFailed");
    const output = captureConsole();

    try {
      await queueFlushFailedCommand();
    } finally {
      output.restore();
    }

    expect(output.logs[0]).toBe("Removed 2 failed job(s).");
  });
});
