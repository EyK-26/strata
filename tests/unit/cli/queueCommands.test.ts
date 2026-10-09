import { afterEach, describe, expect, mock, test } from "bun:test";
import { join } from "node:path";
import {
  resetGracefulShutdownForTests,
  runGracefulShutdown,
} from "@getstrata/core/lifecycle/gracefulShutdown";
import { Job } from "@getstrata/core/queue";
import { restoreEnvVar } from "../../helpers/restoreEnv";
import { captureConsole } from "./helpers";

afterEach(async () => {
  mock.restore();
  resetGracefulShutdownForTests();
  const { restoreDefaultDatabaseConnection } = await import("../testHelpers");
  await restoreDefaultDatabaseConnection();
});

describe("queueWorkCommand", () => {
  test("monorepo queue:work boots secrets, context, default jobs, and discoverJobs", async () => {
    const source = await Bun.file(
      join(import.meta.dir, "../../../src/cli/commands/queueWork.ts"),
    ).text();
    expect(source).toContain("assertProductionSecrets");
    expect(source).toContain("createAppContext");
    expect(source).toContain("registerDefaultJobs");
    expect(source).toContain("discoverJobs");
    expect(source).toContain("runQueueWorkerCommand");
  });

  test("published queue worker helper does not assert production secrets", async () => {
    const source = await Bun.file(
      join(import.meta.dir, "../../../packages/strata-cli/src/queueWorker.ts"),
    ).text();
    expect(source).toContain("await options.boot()");
    expect(source).toContain("queue:work requires REDIS_URL to be set.");
    expect(source).not.toContain("assertProductionSecrets");
    expect(source).not.toContain("createAppContext");
    expect(source).not.toContain("coreProviders");
  });

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
        restoreEnvVar("REDIS_URL", previousRedisUrl);
      }
    }
  });

  test("awaits boot before creating a worker and closes once after rejected boot", async () => {
    const previousRedisUrl = process.env.REDIS_URL;
    process.env.REDIS_URL = "redis://localhost:6379";
    let created = 0;
    let closed = 0;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    mock.module("@getstrata/core/queue/createAppQueue", () => ({
      createFailedJobService: () => ({}),
      createQueueWorker: () => {
        created++;
        return { run: async () => {}, requestStop() {}, close() {} };
      },
    }));
    try {
      const { runQueueWorkerCommand } = await import("@getstrata/cli/queueWorker");
      const running = runQueueWorkerCommand({
        boot: () => pending,
        close: () => {
          closed++;
        },
      });
      await Promise.resolve();
      expect(created).toBe(0);
      release();
      await running;
      expect(created).toBe(1);
      expect(closed).toBe(1);
      await expect(
        runQueueWorkerCommand({
          boot: async () => {
            throw new Error("provider failed");
          },
          close: () => {
            closed++;
          },
        }),
      ).rejects.toThrow("provider failed");
      expect(created).toBe(1);
      expect(closed).toBe(2);
      await runGracefulShutdown("TEST");
      expect(closed).toBe(2);
    } finally {
      release();
      restoreEnvVar("REDIS_URL", previousRedisUrl);
    }
  });

  test("starts the queue worker and drains on shutdown", async () => {
    const previousRedisUrl = process.env.REDIS_URL;
    process.env.REDIS_URL = "redis://localhost:6379";

    let workerStarted = false;
    let workerStopped = false;

    mock.module("@getstrata/core/queue/createAppQueue", () => ({
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

    const { runQueueWorkerCommand } = await import("@getstrata/cli/queueWorker");
    const output = captureConsole();

    try {
      await runQueueWorkerCommand({
        boot: () => undefined,
        close: async () => undefined,
      });
    } finally {
      output.restore();
      if (previousRedisUrl === undefined) {
        delete process.env.REDIS_URL;
      } else {
        restoreEnvVar("REDIS_URL", previousRedisUrl);
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
    mock.module("@getstrata/core/queue/createAppQueue", () => ({
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
    mock.module("@getstrata/core/queue/createAppQueue", () => ({
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
  test("identity-aware replays use the queue capability and refuse unsupported transports", async () => {
    const { FailedJobService } = await import("@getstrata/core/queue/failedJobService");
    const { jobRegistry } = await import("@getstrata/core/queue/jobRegistry");
    const record = {
      id: 20,
      job_name: "test.identity-replay",
      job_id: "stored-identity",
      payload: {},
      exception: "failure",
      failed_at: new Date(),
    };
    jobRegistry.register(
      record.job_name,
      () =>
        new (class extends Job {
          async handle() {
            throw new Error("Must not run inline");
          }
        })(),
    );
    let replayed = 0;
    let deleted = 0;
    let supported = false;
    const service = new FailedJobService({
      findByIdOrThrow: async () => record,
      deleteById: async () => {
        deleted++;
        return true;
      },
    } as never);
    mock.module("@getstrata/core/queue/createAppQueue", () => ({
      resolveQueueConfig: () => ({ driver: "redis" }),
      createFailedJobService: () => service,
      createAppQueue: () => ({
        dispatch: async () => {
          throw new Error("Must preserve identity");
        },
        ...(supported
          ? {
              replay: async (_job: Job, payload: object, id: string) => {
                expect(payload).toEqual(record.payload);
                expect(id).toBe(record.job_id);
                replayed++;
              },
            }
          : {}),
      }),
    }));
    const { queueRetryCommand } = await import("@getstrata/cli/queueFailed");
    await expect(queueRetryCommand("20")).rejects.toThrow("cannot preserve");
    expect(deleted).toBe(0);
    supported = true;
    const output = captureConsole();
    try {
      await queueRetryCommand("20");
    } finally {
      output.restore();
    }
    expect(replayed).toBe(1);
    expect(deleted).toBe(1);
  });
  test("requires a failed job id", async () => {
    const { queueRetryCommand } = await import("../../../src/cli/commands/queueFailed");

    await expect(queueRetryCommand()).rejects.toThrow("queue:retry requires a failed job id.");
  });

  test("admits a failed job through the configured queue and closes standalone ownership", async () => {
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
    let closed = 0;
    let selectedDriver = "";

    const { jobRegistry } = await import("@getstrata/core/queue/jobRegistry");
    jobRegistry.register("test.retry", () => new RetryJob());

    mock.module("@getstrata/core/queue/createAppQueue", () => ({
      resolveQueueConfig: () => ({ driver: "redis" }),
      createFailedJobService: () => ({
        retry: async (_id: number, enqueue: (record: typeof failedJob) => Promise<void>) => {
          await enqueue(failedJob);
          return failedJob;
        },
      }),
      createAppQueue: (driver: string) => {
        selectedDriver = driver;
        return {
          dispatch: async (job: Job, payload: object) => {
            expect(job).toBeInstanceOf(RetryJob);
            expect(payload).toEqual(failedJob.payload);
            runCalled = true;
          },
          close: async () => {
            closed++;
          },
        };
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
    expect(closed).toBe(1);
    expect(selectedDriver).toBe("redis");
    expect(output.logs[0]).toBe("Enqueued failed job #3.");
  });

  test("rejects invalid IDs before booting infrastructure", async () => {
    const { queueRetryCommand } = await import("@getstrata/cli/queueFailed");
    let booted = 0;
    for (const id of ["0", "-1", "1.5", "oops", "Infinity", "9007199254740992"]) {
      await expect(
        queueRetryCommand(id, () => {
          booted++;
        }),
      ).rejects.toThrow("positive integer");
    }
    expect(booted).toBe(0);
  });

  test("dispatch rejection retains recovery state and closes the owned queue", async () => {
    const { FailedJobService } = await import("@getstrata/core/queue/failedJobService");
    const record = {
      id: 8,
      job_name: "test.outage",
      payload: {},
      exception: "boom",
      failed_at: new Date(),
    };
    let deleted = 0;
    let closed = 0;
    const service = new FailedJobService({
      findByIdOrThrow: async () => record,
      deleteById: async () => {
        deleted++;
        return true;
      },
    } as never);
    class OutageJob extends Job {
      async handle() {
        throw new Error("must not execute locally");
      }
    }
    const { jobRegistry } = await import("@getstrata/core/queue/jobRegistry");
    jobRegistry.register(record.job_name, () => new OutageJob());
    mock.module("@getstrata/core/queue/createAppQueue", () => ({
      resolveQueueConfig: () => ({ driver: "redis" }),
      createFailedJobService: () => service,
      createAppQueue: () => ({
        dispatch: async () => {
          throw new Error("Redis unavailable");
        },
        close: async () => {
          closed++;
        },
      }),
    }));
    const { queueRetryCommand } = await import("@getstrata/cli/queueFailed");
    await expect(queueRetryCommand("8")).rejects.toThrow("Redis unavailable");
    expect(deleted).toBe(0);
    expect(closed).toBe(1);
  });

  test("booted applications dispatch through their queue without closing borrowed infrastructure", async () => {
    let booted = false;
    let closed = 0;
    let dispatched = 0;
    class AppJob extends Job {
      async handle() {}
    }
    const record = {
      id: 9,
      job_name: "test.app.retry",
      payload: {},
      exception: "boom",
      failed_at: new Date(),
    };
    const { jobRegistry } = await import("@getstrata/core/queue/jobRegistry");
    jobRegistry.register(record.job_name, () => new AppJob());
    mock.module("@getstrata/core/queue/createAppQueue", () => ({
      createFailedJobService: () => ({
        retry: async (_id: number, enqueue: (entry: typeof record) => Promise<void>) => {
          await enqueue(record);
        },
      }),
      createAppQueue: () => {
        throw new Error("must use application queue");
      },
    }));
    mock.module("@getstrata/core/runtime/applicationRegistry", () => ({
      resolveApplicationQueue: () => {
        expect(booted).toBe(true);
        return {
          dispatch: async () => {
            dispatched++;
          },
          close: async () => {
            closed++;
          },
        };
      },
    }));
    const { queueRetryCommand } = await import("@getstrata/cli/queueFailed");
    const output = captureConsole();
    try {
      await queueRetryCommand("9", () => {
        booted = true;
      });
    } finally {
      output.restore();
    }
    expect(dispatched).toBe(1);
    expect(closed).toBe(0);
  });

  test("rejects unknown job names", async () => {
    mock.module("@getstrata/core/queue/createAppQueue", () => ({
      resolveQueueConfig: () => ({ driver: "redis" }),
      createFailedJobService: () => ({
        retry: async (
          _id: number,
          enqueue: (record: {
            id: number;
            job_name: string;
            payload: object;
            exception: string;
            failed_at: Date;
          }) => Promise<void>,
        ) => {
          const record = {
            id: 1,
            job_name: "missing.job",
            payload: {},
            exception: "boom",
            failed_at: new Date(),
          };
          await enqueue(record);
          return record;
        },
      }),
      createAppQueue: () => ({ dispatch: async () => {}, close: async () => {} }),
    }));

    const { queueRetryCommand } = await import("../../../src/cli/commands/queueFailed");

    await expect(queueRetryCommand("1")).rejects.toThrow('Unknown job "missing.job".');
  });
});

describe("queueFlushFailedCommand", () => {
  test("reports how many failed jobs were removed", async () => {
    mock.module("@getstrata/core/queue/createAppQueue", () => ({
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
