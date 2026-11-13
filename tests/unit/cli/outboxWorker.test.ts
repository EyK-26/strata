import { afterEach, describe, expect, test } from "bun:test";
import { createPersistenceInvocation } from "@getstrata/bootstrap/persistenceInvocation";
import { runOutboxWorkerCommand } from "@getstrata/cli/outboxWorker";
import { createDatabaseBindings } from "@getstrata/core/database/bindings";
import {
  createOutboxMigration,
  createOutboxWorkerTransport,
  createSqlOutboxBindings,
} from "@getstrata/core/events/outbox";
import {
  LifecycleCoordinator,
  resetGracefulShutdownForTests,
} from "@getstrata/core/lifecycle/gracefulShutdown";
import { createApplication } from "@getstrata/core/runtime/application";
import { bounded, deferred, pending } from "../../fixtures/applicationOwnershipSupport";
import { captureConsole } from "./helpers";

afterEach(() => resetGracefulShutdownForTests());

function ownedWorker(
  options: {
    phases?: string[];
    runtimeFailure?: Error;
    startupFailure?: Error;
    drainFailure?: Error;
    closeFailure?: Error;
  } = {},
) {
  let application!: ReturnType<typeof createApplication>;
  const claimed = deferred();
  const bindings = createSqlOutboxBindings({
    connection: "main",
    tenancy: "none",
    listeners: [],
    invoke: async (input, work) => {
      if (
        input.actor?.kind === "system" &&
        input.actor.policy === "outbox.claim" &&
        options.runtimeFailure
      )
        throw options.runtimeFailure;
      const result = await createPersistenceInvocation(application, "main")(input, work);
      if (input.actor?.kind === "system" && input.actor.policy === "outbox.claim")
        claimed.resolve();
      return result;
    },
  });
  const outboxWorker = createOutboxWorkerTransport(bindings.token, { pollMs: 10_000 });
  application = createApplication({
    providers: [
      {
        name: "cleanup-witness",
        async setup(scope) {
          await scope.acquire({
            name: "cleanup-witness",
            open: () => ({ ok: true, value: {} }),
            drain: () => {
              options.phases?.push("drain");
              if (options.drainFailure) throw options.drainFailure;
            },
            flush: () => {
              options.phases?.push("flush");
            },
            close: () => {
              options.phases?.push("close");
              if (options.closeFailure) throw options.closeFailure;
            },
          });
          if (options.startupFailure) throw options.startupFailure;
        },
      },
    ],
    services: [
      ...bindings.services,
      ...createDatabaseBindings({
        default: "main",
        connections: { main: { driver: "sqlite", filename: ":memory:" } },
        preparation: [bindings.token],
      }),
    ],
    transports: [outboxWorker.transport],
  });
  return {
    application,
    outboxWorker,
    claimed,
    async boot() {
      await application.start();
      await createPersistenceInvocation(application, "main")(
        { kind: "command" },
        async ({ database }) => {
          await createOutboxMigration("cli", "sqlite").up({
            unsafe: async <T>(text: string, params: readonly unknown[] = []) =>
              Array.from(await database.execute<T>({ text, params })),
          });
        },
      );
      return { application, outboxWorker };
    },
  };
}
function occurrences(error: unknown): unknown[] {
  return error instanceof AggregateError ? error.errors.flatMap(occurrences) : [error];
}

describe("outbox worker", () => {
  test("announces polling after boot, stays quiet while idle, and reports polling stopped", async () => {
    const output = captureConsole();
    const lifecycle = new LifecycleCoordinator();
    const release = deferred();
    const phases: string[] = [];
    const fixture = ownedWorker({ phases });
    const signals = process.listenerCount("SIGTERM");
    const running = runOutboxWorkerCommand({
      lifecycle,
      boot: async () => {
        await release.promise;
        return fixture.boot();
      },
    });
    try {
      await pending(running);
      expect(output.logs).toEqual([]);
      release.resolve();
      await bounded(fixture.claimed.promise);
      expect(output.logs).toEqual([
        "[outbox:work] Starting SQL outbox polling; idle until deliveries are available.",
      ]);
      expect((await lifecycle.shutdown("TEST")).successful).toBe(true);
      await bounded(running);
      expect(phases).toEqual(["drain", "flush", "close"]);
      expect(fixture.application.state.retainedResources).toEqual([]);
      expect(output.logs).toEqual([
        "[outbox:work] Starting SQL outbox polling; idle until deliveries are available.",
        "[outbox:work] Polling stopped.",
      ]);
      expect(process.listenerCount("SIGTERM")).toBe(signals);
    } finally {
      release.resolve();
      await lifecycle.shutdown("TEST");
      await running;
      output.restore();
    }
  });

  test.each(["boot", "work", "close"] as const)(
    "keeps %s failures observable without a success claim",
    async (phase) => {
      const output = captureConsole();
      const failure = new Error("fixture failure");
      const phases: string[] = [];
      const fixture = ownedWorker({
        phases,
        ...(phase === "work" ? { runtimeFailure: failure } : {}),
        ...(phase === "close" ? { closeFailure: failure } : {}),
      });
      const lifecycle = new LifecycleCoordinator();
      const signals = process.listenerCount("SIGTERM");
      const running = runOutboxWorkerCommand({
        lifecycle,
        boot:
          phase === "boot"
            ? async () => {
                throw failure;
              }
            : fixture.boot,
      });
      const observed = running.then(
        () => {
          throw new Error("Expected worker failure");
        },
        (error) => error,
      );
      try {
        if (phase === "close") {
          await bounded(fixture.claimed.promise);
          await lifecycle.shutdown("TEST");
        }
        expect(occurrences(await bounded(observed))).toContain(failure);
        expect(output.logs.some((line) => line.includes("shutdown completed"))).toBe(false);
        if (phase === "boot") expect(output.logs).toEqual([]);
        if (phase === "close") expect(phases).toEqual(["drain", "flush", "close"]);
        expect(process.listenerCount("SIGTERM")).toBe(signals);
      } finally {
        await fixture.application.stop();
        output.restore();
      }
    },
  );

  test("canonical application retains runtime and independent cleanup failures", async () => {
    const output = captureConsole();
    const runtime = new Error("configured failure");
    const cleanup = new Error("independent cleanup failure");
    const fixture = ownedWorker({ runtimeFailure: runtime, drainFailure: cleanup });
    try {
      const rejected = await runOutboxWorkerCommand({ boot: fixture.boot }).catch((error) => error);
      expect(occurrences(rejected)).toContain(runtime);
      expect(occurrences(rejected)).toContain(cleanup);
      expect(fixture.application.state.phase).toBe("failed");
      expect(
        fixture.application.state.errors.some((entry) =>
          occurrences(entry.error).includes(runtime),
        ),
      ).toBe(true);
    } finally {
      await fixture.application.stop();
      output.restore();
    }
  });

  test("removed raw sources and parallel cleanup are rejected before boot", async () => {
    let boots = 0;
    const boot = async () => {
      boots++;
      return ownedWorker().boot();
    };
    // @ts-expect-error Raw listener construction is no longer supported.
    await expect(runOutboxWorkerCommand({ boot, listeners: [] })).rejects.toThrow(
      "application-owned",
    );
    // @ts-expect-error Raw coordinators cannot replace the pre-registered worker.
    await expect(runOutboxWorkerCommand({ boot, outbox: {} })).rejects.toThrow("application-owned");
    // @ts-expect-error Canonical application owns cleanup.
    await expect(runOutboxWorkerCommand({ boot, close() {} })).rejects.toThrow("application-owned");
    expect(boots).toBe(0);
  });

  test("real SIGTERM drains an active SQL delivery before infrastructure closes", async () => {
    const child = Bun.spawn([process.execPath, "run", "tests/fixtures/outboxShutdownWorker.ts"], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });
    const reader = child.stdout.getReader();
    const decoder = new TextDecoder();
    let output = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 4000);
    try {
      while (!output.includes("ACTIVE\n")) {
        const chunk = await reader.read();
        if (chunk.done)
          throw new Error(
            `Worker exited before delivery: ${output}; ${await new Response(child.stderr).text()}`,
          );
        output += decoder.decode(chunk.value, { stream: true });
      }
      child.kill("SIGTERM");
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        output += decoder.decode(chunk.value, { stream: true });
      }
      expect(await new Response(child.stderr).text()).toBe("");
      expect(await child.exited).toBe(0);
      expect(output.trim().split("\n")).toEqual([
        "[outbox:work] Starting SQL outbox polling; idle until deliveries are available.",
        "ACTIVE",
        "FINISHED",
        "DRAINED",
        "FLUSHED",
        "CLOSED",
        "[outbox:work] Polling stopped.",
      ]);
    } finally {
      clearTimeout(timer);
      child.kill("SIGKILL");
      await child.exited;
    }
  });

  test("failed canonical startup closes acquired resources once without polling", async () => {
    const output = captureConsole();
    const failure = new Error("provider boot failed");
    const phases: string[] = [];
    const fixture = ownedWorker({ phases, startupFailure: failure });
    try {
      const rejected = await runOutboxWorkerCommand({ boot: fixture.boot }).catch((error) => error);
      expect(occurrences(rejected)).toContain(failure);
      expect(output.logs).toEqual([]);
      expect(phases.filter((phase) => phase === "close")).toHaveLength(1);
      expect((await fixture.application.stop()).successful).toBe(true);
      expect(fixture.application.state.retainedResources).toEqual([]);
    } finally {
      await fixture.application.stop();
      output.restore();
    }
  });

  test("boot rejection is preserved and signal handlers are uninstalled", async () => {
    const failure = new Error("boot failed");
    const signals = process.listenerCount("SIGTERM");
    const rejected = await runOutboxWorkerCommand({
      boot: async () => {
        throw failure;
      },
    }).catch((error) => error);
    expect(occurrences(rejected)).toContain(failure);
    expect(occurrences(rejected).every((error) => error === failure)).toBe(true);
    expect(process.listenerCount("SIGTERM")).toBe(signals);
  });

  test("shutdown during boot waits for returned owner, never starts polling, and closes once", async () => {
    const output = captureConsole();
    const fixture = ownedWorker({ phases: [] });
    const lifecycle = new LifecycleCoordinator();
    const entered = deferred();
    const release = deferred();
    const running = runOutboxWorkerCommand({
      lifecycle,
      boot: async () => {
        entered.resolve();
        await release.promise;
        return fixture.boot();
      },
    });
    try {
      await entered.promise;
      const shutdown = lifecycle.shutdown("EARLY_SIGNAL");
      await pending(shutdown);
      release.resolve();
      expect((await bounded(shutdown)).successful).toBe(true);
      await bounded(running);
      expect(output.logs).toEqual([]);
      expect(fixture.application.state.phase).toBe("stopped");
      expect(fixture.application.state.retainedResources).toEqual([]);
    } finally {
      release.resolve();
      await running;
      output.restore();
    }
  });

  test("a boot rejection during early shutdown makes the signal lifecycle fail", async () => {
    const output = captureConsole();
    const lifecycle = new LifecycleCoordinator();
    const release = deferred();
    const failure = new Error("boot failed after early signal");
    const signals = process.listenerCount("SIGTERM");
    const running = runOutboxWorkerCommand({
      lifecycle,
      boot: async () => {
        await release.promise;
        throw failure;
      },
    });
    const observed = running.catch((error) => error);
    try {
      const shutdown = lifecycle.shutdown("EARLY_SIGNAL");
      await pending(shutdown);
      release.resolve();
      const result = await bounded(shutdown);
      expect(result.successful).toBe(false);
      expect(result.errors.map((entry) => entry.error)).toContain(failure);
      expect(occurrences(await bounded(observed))).toContain(failure);
      expect(output.logs).toEqual([]);
      expect(process.listenerCount("SIGTERM")).toBe(signals);
    } finally {
      release.resolve();
      await observed;
      output.restore();
    }
  });

  test.each([0, 1, 2, 3, 4, 5])(
    "settled boot failure remains in signal shutdown after %s extra microtasks",
    async (hops) => {
      const output = captureConsole();
      const lifecycle = new LifecycleCoordinator();
      const failure = Object.freeze({ opaque: "boot rejected" });
      const signals = process.listenerCount("SIGTERM");
      let shutdown: ReturnType<LifecycleCoordinator["shutdown"]> | undefined;
      try {
        const rejected = await runOutboxWorkerCommand({
          lifecycle,
          boot: () => {
            const schedule = (remaining: number): void =>
              queueMicrotask(() => {
                if (remaining) schedule(remaining - 1);
                else shutdown = lifecycle.shutdown("SIGNAL");
              });
            schedule(hops);
            return Promise.reject(failure);
          },
        }).catch((error) => error);
        if (!shutdown) throw new Error("Expected signal shutdown to run");
        const result = await shutdown;
        expect(result.successful).toBe(false);
        expect(result.errors.map((entry) => entry.error)).toContain(failure);
        expect(occurrences(rejected)).toContain(failure);
        expect(occurrences(rejected).every((error) => error === failure)).toBe(true);
        expect(output.logs).toEqual([]);
        expect(process.listenerCount("SIGTERM")).toBe(signals);
      } finally {
        output.restore();
      }
    },
  );

  test("real SIGTERM during failed boot exits with failure", async () => {
    const child = Bun.spawn(
      [process.execPath, "run", "tests/fixtures/outboxShutdownWorker.ts", "--boot-failure"],
      { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" },
    );
    const reader = child.stdout.getReader();
    const decoder = new TextDecoder();
    let output = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 4000);
    try {
      while (!output.includes("BOOTING\n")) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error(`Worker exited before boot signal: ${output}`);
        output += decoder.decode(chunk.value, { stream: true });
      }
      child.kill("SIGTERM");
      while (!(await reader.read()).done) {}
      expect(await child.exited).toBe(1);
      expect(await new Response(child.stderr).text()).toContain(
        "native boot failure after SIGTERM",
      );
      expect(output).not.toContain("Starting SQL outbox polling");
    } finally {
      clearTimeout(timer);
      child.kill("SIGKILL");
      await child.exited;
    }
  });

  test("already shutting-down lifecycle refuses boot", async () => {
    const lifecycle = new LifecycleCoordinator();
    await lifecycle.shutdown();
    let boots = 0;
    await expect(
      runOutboxWorkerCommand({
        lifecycle,
        boot: async () => {
          boots++;
          return ownedWorker().boot();
        },
      }),
    ).rejects.toThrow("during shutdown");
    expect(boots).toBe(0);
  });
});
