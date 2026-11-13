import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  type QueueCommandApplication,
  queueFailedCommand,
  queueFlushFailedCommand,
  queueRetryCommand,
} from "@getstrata/cli/queueFailed";
import { runQueueWorkerCommand } from "@getstrata/cli/queueWorker";
import { LifecycleCoordinator } from "@getstrata/core/lifecycle/gracefulShutdown";
import { Job, type Queue } from "@getstrata/core/queue";
import { jobRegistry } from "@getstrata/core/queue/jobRegistry";
import { createQueueWorkerTransport } from "@getstrata/core/queue/queueWorkerTransport";
import { createApplication } from "@getstrata/core/runtime/application";
import { createQueuePersistenceFixture } from "../../helpers/queuePersistence";
import { captureConsole } from "./helpers";

async function failedFixture(queue: Queue = { dispatch: async () => {} }) {
  const fixture = await createQueuePersistenceFixture();
  const app: QueueCommandApplication = {
    application: fixture.application,
    invoke: fixture.invoke,
    queueServices: fixture.services,
    queue,
  };
  return { ...fixture, boot: async () => app };
}
function registeredJob() {
  const name = `queue-cli-${crypto.randomUUID()}`;
  jobRegistry.register(
    name,
    () =>
      new (class extends Job {
        async handle() {
          throw Error("Must not execute inline");
        }
      })(),
  );
  return name;
}
async function record(
  fixture: Awaited<ReturnType<typeof failedFixture>>,
  name = registeredJob(),
  jobId?: string,
) {
  return fixture.services.recordFailure({
    jobName: name,
    jobId,
    payload: { marker: "payload" },
    exception: "failure",
  });
}

describe("queueWorkCommand", () => {
  test("monorepo queue:work delegates explicit application setup, including secrets and discovery", async () => {
    const source = await Bun.file(
      join(import.meta.dir, "../../../src/cli/commands/queueWork.ts"),
    ).text();
    const assembly = await Bun.file(
      join(import.meta.dir, "../../../src/cli/commands/queueApplication.ts"),
    ).text();
    expect(source).toContain("runQueueWorkerCommand");
    expect(source).toContain("bootQueueApplication(true)");
    expect(assembly).toContain("assertProductionSecrets");
    expect(assembly).toContain("createAppContext");
    expect(assembly).toContain("transports:");
    const provider = await Bun.file(
      join(import.meta.dir, "../../../src/bootstrap/providers/queue.ts"),
    ).text();
    expect(provider).toContain("registerDefaultJobs");
    expect(provider).toContain("discoverJobs");
  });
  test("published queue worker helper delegates boot and never asserts production secrets", async () => {
    const source = await Bun.file(
      join(import.meta.dir, "../../../packages/strata-cli/src/queueWorker.ts"),
    ).text();
    expect(source).toContain("await options.boot()");
    expect(source).not.toContain("assertProductionSecrets");
    expect(source).not.toContain("createAppContext");
    expect(source).not.toContain("coreProviders");
  });
  test("requires an explicitly configured application-owned worker", async () => {
    const fixture = await failedFixture();
    await expect(runQueueWorkerCommand({ boot: fixture.boot })).rejects.toThrow(
      "application-owned worker transport",
    );
    expect(fixture.application.state.phase).toBe("stopped");
  });
  test("awaits boot before starting a worker and propagates failed startup", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let starts = 0;
    const application = createApplication({ providers: [] });
    await application.start();
    const output = captureConsole();
    try {
      const pending = runQueueWorkerCommand({
        boot: async () => {
          await gate;
          return {
            application,
            invoke: async () => {
              throw Error("unused");
            },
            queueServices: {} as never,
            queue: { dispatch: async () => {} },
            worker: {
              start: async () => {
                starts++;
              },
            },
          };
        },
      });
      await Promise.resolve();
      expect(starts).toBe(0);
      expect(output.logs).toEqual([]);
      release();
      await pending;
      expect(starts).toBe(1);
      expect(application.state.phase).toBe("stopped");
      await expect(
        runQueueWorkerCommand({
          boot: async () => {
            throw Error("provider failed");
          },
        }),
      ).rejects.toThrow("provider failed");
      expect(starts).toBe(1);
    } finally {
      release();
      output.restore();
      await application.stop();
    }
  });
  test("direct application shutdown stops admission, drains pending native worker work and closes once", async () => {
    const trace: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const runtime = createQueueWorkerTransport({
      redisUrl: "redis://unused",
      queueServices: {} as never,
      createWorker: () => ({
        requestStop() {
          trace.push("stop");
        },
        async run() {
          trace.push("run");
          await gate;
          trace.push("settled");
        },
        close() {
          trace.push("close");
        },
      }),
    });
    const application = createApplication({ providers: [], transports: [runtime.transport] });
    await application.start();
    const lifecycle = new LifecycleCoordinator();
    const output = captureConsole();
    try {
      const pending = runQueueWorkerCommand({
        lifecycle,
        boot: () => ({
          application,
          invoke: async () => {
            throw Error("unused");
          },
          queueServices: {} as never,
          queue: { dispatch: async () => {} },
          worker: runtime,
        }),
      });
      await Bun.sleep(1);
      const stopping = application.stop();
      await Bun.sleep(1);
      expect(trace).toEqual(["run", "stop"]);
      release();
      expect((await stopping).successful).toBe(true);
      await pending;
      expect(trace).toEqual(["run", "stop", "settled", "close"]);
      await application.stop();
      expect(trace.filter((x) => x === "close")).toHaveLength(1);
    } finally {
      release();
      output.restore();
      await application.stop();
    }
  });
});
describe("queueFailedCommand", () => {
  test("prints a message when there are no failed jobs", async () => {
    const fixture = await failedFixture();
    const output = captureConsole();
    try {
      await queueFailedCommand(fixture.boot);
      expect(output.logs).toEqual(["No failed jobs."]);
    } finally {
      output.restore();
      await fixture.application.stop();
    }
  });
  test("lists recent failed jobs", async () => {
    const fixture = await failedFixture();
    const row = await record(fixture, "webhooks.dispatch");
    const output = captureConsole();
    try {
      await queueFailedCommand(fixture.boot);
      expect(output.logs).toEqual([
        `#${row.id} webhooks.dispatch failed at ${row.failed_at.toISOString()}`,
      ]);
    } finally {
      output.restore();
      await fixture.application.stop();
    }
  });
});
describe("queueRetryCommand", () => {
  test("identity-aware replays use the queue capability and refuse unsupported transports", async () => {
    let replayed = 0;
    const supported = await failedFixture({
      dispatch: async () => {
        throw Error("Must preserve identity");
      },
      replay: async (_job, payload, id) => {
        expect(payload as object).toEqual({ marker: "payload" });
        expect(id).toBe("stored-identity");
        replayed++;
      },
    });
    const supportedRow = await record(supported, registeredJob(), "stored-identity");
    try {
      await queueRetryCommand(String(supportedRow.id), supported.boot);
      expect(replayed).toBe(1);
    } finally {
      await supported.application.stop();
    }
    const refused = await failedFixture({
      dispatch: async () => {
        throw Error("Must preserve identity");
      },
    });
    const refusedRow = await record(refused, registeredJob(), "stored-identity");
    const refusedBoot = async () => ({
      ...(await refused.boot()),
      queueServices: {
        ...refused.services,
        retry: async (id: number, admit: Parameters<typeof refused.services.retry>[1]) => {
          try {
            return await refused.services.retry(id, admit);
          } finally {
            expect(await refused.services.listRecent()).toHaveLength(1);
          }
        },
      },
    });
    await expect(queueRetryCommand(String(refusedRow.id), refusedBoot)).rejects.toThrow(
      "cannot preserve",
    );
  });
  test("requires a failed job id", async () => {
    await expect(
      queueRetryCommand(undefined, async () => {
        throw Error("must not boot");
      }),
    ).rejects.toThrow("positive integer");
  });
  test("admits a failed job through the configured queue before closing application ownership", async () => {
    let dispatched = 0;
    const fixture = await failedFixture({
      dispatch: async (_job, payload) => {
        expect(payload as object).toEqual({ marker: "payload" });
        expect(await fixture.services.listRecent()).toHaveLength(1);
        dispatched++;
      },
    });
    const row = await record(fixture);
    const output = captureConsole();
    try {
      await queueRetryCommand(String(row.id), fixture.boot);
      expect(dispatched).toBe(1);
      expect(output.logs).toEqual([`Enqueued failed job #${row.id}.`]);
      expect(fixture.application.state.phase).toBe("stopped");
    } finally {
      output.restore();
      await fixture.application.stop();
    }
  });
  test("rejects invalid IDs before booting infrastructure", async () => {
    let booted = 0;
    for (const id of ["0", "-1", "1.5", "abc", "Infinity"]) {
      await expect(
        queueRetryCommand(id, async () => {
          booted++;
          throw Error("must not boot");
        }),
      ).rejects.toThrow("positive integer");
    }
    expect(booted).toBe(0);
  });
  test("dispatch rejection retains recovery state and closes the owned application", async () => {
    const fixture = await failedFixture({
      dispatch: async () => {
        throw Error("Redis unavailable");
      },
    });
    const row = await record(fixture);
    const boot = async () => ({
      ...(await fixture.boot()),
      queueServices: {
        ...fixture.services,
        retry: async (id: number, admit: Parameters<typeof fixture.services.retry>[1]) => {
          try {
            return await fixture.services.retry(id, admit);
          } finally {
            expect(await fixture.services.listRecent()).toHaveLength(1);
          }
        },
      },
    });
    await expect(queueRetryCommand(String(row.id), boot)).rejects.toThrow("Redis unavailable");
    expect(fixture.application.state.phase).toBe("stopped");
  });
  test("booted applications dispatch through their configured queue and stop that same owner", async () => {
    let admitted = 0;
    const fixture = await failedFixture({
      dispatch: async () => {
        admitted++;
      },
    });
    const row = await record(fixture);
    const output = captureConsole();
    try {
      await queueRetryCommand(String(row.id), fixture.boot);
      expect(admitted).toBe(1);
      expect(fixture.application.state.phase).toBe("stopped");
    } finally {
      output.restore();
      await fixture.application.stop();
    }
  });
  test("rejects unknown job names and retains the record before stopping", async () => {
    const fixture = await failedFixture();
    const row = await record(fixture, "unknown-queue-job");
    const boot = async () => ({
      ...(await fixture.boot()),
      queueServices: {
        ...fixture.services,
        retry: async (id: number, admit: Parameters<typeof fixture.services.retry>[1]) => {
          try {
            return await fixture.services.retry(id, admit);
          } finally {
            expect(await fixture.services.listRecent()).toHaveLength(1);
          }
        },
      },
    });
    await expect(queueRetryCommand(String(row.id), boot)).rejects.toThrow("Unknown job");
  });
});
test("reports how many failed jobs were removed", async () => {
  const fixture = await failedFixture();
  await record(fixture);
  await record(fixture);
  const output = captureConsole();
  try {
    await queueFlushFailedCommand(fixture.boot);
    expect(output.logs).toEqual(["Removed 2 failed job(s)."]);
  } finally {
    output.restore();
    await fixture.application.stop();
  }
});

test("application-owned bounded polling retains its actual work through shutdown", async () => {
  const trace: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const worker = createQueueWorkerTransport({
    redisUrl: "redis://unused",
    queueServices: {} as never,
    createWorker: () => ({
      requestStop() {
        trace.push("stop");
      },
      async run() {
        throw Error("Must use bounded poll");
      },
      async processNext() {
        trace.push("poll");
        await gate;
        trace.push("settled");
        return true;
      },
      close() {
        trace.push("close");
      },
    }),
  });
  const application = createApplication({ providers: [], transports: [worker.transport] });
  await application.start();
  try {
    const polling = worker.processNext();
    await Promise.resolve();
    await expect(worker.processNext()).rejects.toThrow("bounded admission");
    await expect(worker.start()).rejects.toThrow("not available for admission");
    const stopping = application.stop();
    await Bun.sleep(1);
    expect(trace).toEqual(["poll", "stop"]);
    await expect(worker.processNext()).rejects.toThrow("bounded admission");
    release();
    expect(await polling).toBe(true);
    expect((await stopping).successful).toBe(true);
    expect(trace).toEqual(["poll", "stop", "settled", "close"]);
  } finally {
    release();
    await application.stop();
  }
});

test("queue worker factory failure retains unknown acquisition and never fabricates cleanup of an unreturned native handle", async () => {
  const persistence = await createQueuePersistenceFixture();
  const failure = new Error("native worker factory failed after acquiring a handle");
  let native: Database | undefined;
  let factories = 0;
  let operatorCloses = 0;
  const worker = createQueueWorkerTransport({
    redisUrl: "redis://unused",
    queueServices: persistence.services,
    createWorker: () => {
      factories++;
      native = new Database(":memory:");
      native.exec(
        "CREATE TABLE factory_owned (id INTEGER PRIMARY KEY); INSERT INTO factory_owned VALUES (19)",
      );
      throw failure;
    },
  });
  const application = createApplication({ providers: [], transports: [worker.transport] });
  try {
    await expect(worker.start()).rejects.toThrow("not available for admission");
    expect(factories).toBe(0);
    await expect(application.start()).rejects.toThrow();
    expect(factories).toBe(1);
    const stopped = await application.stop();
    expect(stopped.successful).toBe(false);
    expect(stopped.snapshot.retainedResources).toEqual(["queue.worker"]);
    expect(stopped.snapshot.errors.some((entry) => entry.error === failure)).toBe(true);
    await expect(worker.processNext()).rejects.toThrow("bounded admission");
    expect(native?.query("SELECT id FROM factory_owned").all()).toEqual([{ id: 19 }]);
    expect(await application.stop()).toBe(stopped);
  } finally {
    await application.stop();
    // Explicit operator recovery does not turn the original unknown acquisition into clean shutdown.
    if (native) {
      native.close();
      operatorCloses++;
    }
    expect((await persistence.application.stop()).successful).toBe(true);
  }
  expect(operatorCloses).toBe(1);
});

test("queue transport denies bounded polling without adapter capability and closes once without admitting a run", async () => {
  const persistence = await createQueuePersistenceFixture();
  let constructions = 0;
  let runs = 0;
  let stops = 0;
  let closes = 0;
  const worker = createQueueWorkerTransport({
    redisUrl: "redis://unused",
    queueServices: persistence.services,
    createWorker: () => {
      constructions++;
      return {
        requestStop() {
          stops++;
        },
        async run() {
          runs++;
        },
        close() {
          closes++;
        },
      };
    },
  });
  const application = createApplication({ providers: [], transports: [worker.transport] });
  try {
    await expect(worker.start()).rejects.toThrow("not available for admission");
    await expect(worker.processNext()).rejects.toThrow("bounded admission");
    expect(constructions).toBe(0);
    await application.start();
    expect(constructions).toBe(1);
    await expect(worker.processNext()).rejects.toThrow("does not support bounded polling");
    expect(runs).toBe(0);
    const result = await application.stop();
    expect(result.successful).toBe(true);
    expect(result.snapshot.retainedResources).toEqual([]);
    await expect(worker.start()).rejects.toThrow("not available for admission");
    await expect(worker.processNext()).rejects.toThrow("bounded admission");
    expect({ constructions, runs, stops, closes }).toEqual({
      constructions: 1,
      runs: 0,
      stops: 1,
      closes: 1,
    });
    await application.stop();
    expect(closes).toBe(1);
  } finally {
    await application.stop();
    expect((await persistence.application.stop()).successful).toBe(true);
  }
});
