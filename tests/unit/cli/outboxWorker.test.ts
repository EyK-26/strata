import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { SqlOutbox } from "@getstrata/core/events/outbox";
import {
  LifecycleCoordinator,
  resetGracefulShutdownForTests,
} from "@getstrata/core/lifecycle/gracefulShutdown";

afterEach(() => {
  resetGracefulShutdownForTests();
});

describe("outbox worker", () => {
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
        "ACTIVE",
        "FINISHED",
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
