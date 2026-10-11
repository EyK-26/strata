import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { SqlOutbox } from "@getstrata/core/events/outbox";
import {
  LifecycleCoordinator,
  resetGracefulShutdownForTests,
} from "@getstrata/core/lifecycle/gracefulShutdown";
import { captureConsole } from "./helpers";

afterEach(() => {
  resetGracefulShutdownForTests();
});

describe("outbox worker", () => {
  test("announces polling after boot, stays quiet while idle, and reports polling stopped", async () => {
    const { runOutboxWorkerCommand } = await import("@getstrata/cli/outboxWorker");
    const output = captureConsole();
    const lifecycle = new LifecycleCoordinator();
    let releaseBoot!: () => void;
    const boot = new Promise<void>((resolve) => {
      releaseBoot = resolve;
    });
    let admitted!: () => void;
    const active = new Promise<void>((resolve) => {
      admitted = resolve;
    });
    let closed = false;
    const running = runOutboxWorkerCommand({
      lifecycle,
      boot: () => boot,
      outbox: {
        async work({ signal }) {
          expect(output.logs).toEqual([
            "[outbox:work] Starting SQL outbox polling; idle until deliveries are available.",
          ]);
          admitted();
          await new Promise<void>((resolve) =>
            signal.addEventListener("abort", () => resolve(), { once: true }),
          );
        },
      },
      close: () => {
        closed = true;
      },
    });
    try {
      await Promise.resolve();
      expect(output.logs).toEqual([]);
      releaseBoot();
      await active;
      await Bun.sleep(10);
      expect(output.logs).toHaveLength(1);
      await lifecycle.shutdown("TEST");
      await running;
      expect(closed).toBe(true);
      expect(output.logs).toEqual([
        "[outbox:work] Starting SQL outbox polling; idle until deliveries are available.",
        "[outbox:work] Polling stopped.",
      ]);
    } finally {
      releaseBoot();
      await lifecycle.shutdown("TEST");
      await running;
      output.restore();
    }
  });
  test.each(["boot", "work", "close"])(
    "keeps %s failures observable without a success claim",
    async (phase) => {
      const { runOutboxWorkerCommand } = await import("@getstrata/cli/outboxWorker");
      const output = captureConsole();
      const fail = () => {
        throw new Error("fixture failure");
      };
      try {
        await expect(
          runOutboxWorkerCommand({
            boot: phase === "boot" ? fail : () => {},
            outbox: {
              work: async () => {
                if (phase === "work") fail();
              },
            },
            close: phase === "close" ? fail : () => {},
          }),
        ).rejects.toThrow();
        expect(output.logs.some((line) => line.includes("shutdown completed"))).toBe(false);
        if (phase === "boot") expect(output.logs).toEqual([]);
      } finally {
        output.restore();
      }
    },
  );
  test("configured worker retains its receiver and startup/runtime cleanup", async () => {
    const { runOutboxWorkerCommand } = await import("@getstrata/cli/outboxWorker");
    const phases: string[] = [];
    const outbox = {
      async work({ signal }: { signal: AbortSignal }) {
        expect(this).toBe(outbox);
        expect(signal.aborted).toBe(false);
        phases.push("work");
        throw new Error("configured failure");
      },
    };
    await expect(
      runOutboxWorkerCommand({
        outbox,
        boot: () => {
          phases.push("boot");
        },
        drain: () => {
          phases.push("drain");
        },
        flush: () => {
          phases.push("flush");
        },
        close: () => {
          phases.push("close");
        },
      }),
    ).rejects.toThrow("configured failure");
    expect(phases).toEqual(["boot", "work", "drain", "flush", "close"]);
  });
  test("ambiguous or missing sources fail before boot", async () => {
    const { runOutboxWorkerCommand } = await import("@getstrata/cli/outboxWorker");
    let boots = 0;
    const boot = () => {
      boots += 1;
    };
    await expect(
      // @ts-expect-error Exercise untyped callers, which must reject ambiguous configuration.
      runOutboxWorkerCommand({ boot, listeners: [], outbox: new SqlOutbox({ listeners: [] }) }),
    ).rejects.toThrow("exactly one");
    // @ts-expect-error Exercise an untyped caller without a worker source.
    await expect(runOutboxWorkerCommand({ boot })).rejects.toThrow("exactly one");
    // @ts-expect-error Runtime validation also checks the configured worker contract.
    await expect(runOutboxWorkerCommand({ boot, outbox: {} })).rejects.toThrow("work()");
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
        if (chunk.done) throw new Error(`Worker exited before delivery: ${output}`);
        output += decoder.decode(chunk.value, { stream: true });
      }
      child.kill("SIGTERM");
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        output += decoder.decode(chunk.value, { stream: true });
      }
      const errors = await new Response(child.stderr).text();
      expect(errors).toBe("");
      expect(await child.exited).toBe(0);
      expect(output.trim().split("\n")).toEqual([
        "[outbox:work] Starting SQL outbox polling; idle until deliveries are available.",
        "ACTIVE",
        "FINISHED",
        "[outbox:work] Polling stopped.",
        "DRAINED",
        "FLUSHED",
        "CLOSED",
      ]);
    } finally {
      clearTimeout(timer);
      child.kill("SIGKILL");
      await child.exited;
    }
  });
  test("closes after a rejected boot and does not start delivery", async () => {
    let closed = 0;
    const { runOutboxWorkerCommand } = await import("@getstrata/cli/outboxWorker");
    await expect(
      runOutboxWorkerCommand({
        listeners: [],
        boot: async () => {
          throw new Error("boot failed");
        },
        close: () => {
          closed += 1;
        },
      }),
    ).rejects.toThrow("boot failed");
    expect(closed).toBe(1);
  });
  test("shutdown waits for active work before drain, flush and close", async () => {
    const { runOutboxWorkerCommand } = await import("@getstrata/cli/outboxWorker");
    const lifecycle = new LifecycleCoordinator({ timeoutMs: 1000 });
    const phases: string[] = [];
    let admitted!: () => void;
    const active = new Promise<void>((resolve) => {
      admitted = resolve;
    });
    let stopped!: () => void;
    const stopping = new Promise<void>((resolve) => {
      stopped = resolve;
    });
    let complete!: () => void;
    const completion = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const work = spyOn(SqlOutbox.prototype, "work").mockImplementation(async ({ signal }) => {
      phases.push("active");
      admitted();
      await new Promise<void>((resolve) => {
        signal.addEventListener(
          "abort",
          () => {
            phases.push("stop");
            stopped();
            resolve();
          },
          { once: true },
        );
      });
      await completion;
      phases.push("finished");
    });
    const running = runOutboxWorkerCommand({
      lifecycle,
      listeners: [],
      boot: () => {},
      drain: () => {
        phases.push("drain");
      },
      flush: () => {
        phases.push("flush");
      },
      close: () => {
        phases.push("close");
      },
    });
    try {
      await active;
      const shutdown = lifecycle.shutdown("SIGTERM");
      await stopping;
      expect(phases).toEqual(["active", "stop"]);
      complete();
      expect((await shutdown).successful).toBe(true);
      await running;
      expect(phases).toEqual(["active", "stop", "finished", "drain", "flush", "close"]);
    } finally {
      complete();
      await running;
      work.mockRestore();
    }
  });
  test("runtime rejection still drains, flushes and closes once", async () => {
    const { runOutboxWorkerCommand } = await import("@getstrata/cli/outboxWorker");
    const work = spyOn(SqlOutbox.prototype, "work").mockRejectedValue(new Error("delivery failed"));
    const phases: string[] = [];
    try {
      await expect(
        runOutboxWorkerCommand({
          listeners: [],
          boot: () => {},
          drain: () => {
            phases.push("drain");
          },
          flush: () => {
            phases.push("flush");
          },
          close: () => {
            phases.push("close");
          },
        }),
      ).rejects.toThrow("delivery failed");
      expect(phases).toEqual(["drain", "flush", "close"]);
    } finally {
      work.mockRestore();
    }
  });
});
