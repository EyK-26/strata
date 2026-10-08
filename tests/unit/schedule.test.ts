import { describe, expect, mock, test } from "bun:test";

describe("Schedule", () => {
  test("returns every-minute tasks", async () => {
    mock.restore();

    const { Schedule } = await import("@getstrata/core/scheduler/schedule");
    const schedule = new Schedule();
    schedule.command("* * * * *", "heartbeat", () => undefined);

    expect(schedule.dueTasks(new Date("2026-01-01T12:34:00Z"))).toHaveLength(1);
  });

  test("runs */N minute tasks and rejects unsupported cron", async () => {
    mock.restore();

    const { Schedule } = await import("@getstrata/core/scheduler/schedule");
    const schedule = new Schedule();
    schedule.command("*/5 * * * *", "every-five", () => undefined);

    expect(schedule.dueTasks(new Date("2026-01-01T12:00:00Z"))).toHaveLength(1);
    expect(schedule.dueTasks(new Date("2026-01-01T12:01:00Z"))).toHaveLength(0);
    expect(() => schedule.command("0 2 * *", "broken", () => undefined)).toThrow(
      /Unsupported schedule expression/,
    );
  });

  test("uses Bun.cron.parse for hourly and daily expressions", async () => {
    mock.restore();

    const { Schedule, runDueScheduledTasks } = await import("@getstrata/core/scheduler/schedule");
    const schedule = new Schedule();
    const midHour = mock(() => undefined);
    schedule.command("15 3 * * *", "mid-hour", midHour);
    schedule.command("@hourly", "hourly", () => undefined);

    expect(schedule.dueTasks(new Date("2026-01-01T03:15:00Z")).map((task) => task.name)).toEqual([
      "mid-hour",
    ]);
    expect(schedule.dueTasks(new Date("2026-01-01T13:00:00Z")).map((task) => task.name)).toEqual([
      "hourly",
    ]);
    expect(schedule.dueTasks(new Date("2026-01-01T12:34:00Z"))).toHaveLength(0);

    expect(await runDueScheduledTasks(schedule, new Date("2026-01-01T03:15:00Z"))).toBe(1);
    expect(midHour).toHaveBeenCalledTimes(1);
  });
});

test("scheduler stop finishes the active task without admitting another due task", async () => {
  mock.restore();
  const { Schedule, runDueScheduledTasks } = await import("@getstrata/core/scheduler/schedule");
  const schedule = new Schedule();
  const controller = new AbortController();
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let completed = false;
  let second = false;
  schedule.command("* * * * *", "active", async () => {
    entered();
    await gate;
    completed = true;
  });
  schedule.command("* * * * *", "not-admitted", () => {
    second = true;
  });
  const running = runDueScheduledTasks(schedule, new Date(), { signal: controller.signal });
  await started;
  controller.abort();
  expect(completed).toBe(false);
  release();
  expect(await running).toBe(1);
  expect(completed).toBe(true);
  expect(second).toBe(false);
});

test("single-runner deduplicates the minute and supplies a stable per-task occurrence identity", async () => {
  mock.restore();
  const { Schedule, runDueScheduledTasks } = await import("@getstrata/core/scheduler/schedule");
  const ids: string[] = [];
  const schedule = new Schedule()
    .command("* * * * *", "one", async (context) => {
      ids.push(context.occurrenceId);
      expect(context.scheduledAt.getUTCSeconds()).toBe(0);
      expect(context.signal.aborted).toBe(false);
      await context.assertOwnership();
    })
    .command("* * * * *", "two", (context) => {
      ids.push(context.occurrenceId);
    });
  const now = new Date();
  const options = { coordination: "single-runner" as const };
  expect(await runDueScheduledTasks(schedule, now, options)).toBe(2);
  expect(await runDueScheduledTasks(schedule, now, options)).toBe(0);
  expect(new Set(ids).size).toBe(2);
  expect(() => schedule.command("* * * * *", "one", () => {})).toThrow("unique");
  expect(() => schedule.command("* * * * *", "   ", () => {})).toThrow("nonempty");
  expect(() => schedule.command("* * * * *", "x".repeat(201), () => {})).toThrow();
});

test("lease loss aborts the handler and cannot count its side effect as completed", async () => {
  mock.restore();
  const { Schedule, runDueScheduledTasks, SchedulerLeaseLostError } = await import(
    "@getstrata/core/scheduler/schedule"
  );
  let acknowledged = false;
  let released = false;
  const store = {
    acquire: async () => true,
    renew: async () => false,
    complete: async () => {
      acknowledged = true;
      return true;
    },
    release: async () => {
      released = true;
    },
  };
  const schedule = new Schedule().command(
    "* * * * *",
    "lost",
    async ({ signal, assertOwnership }) => {
      await new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      );
      expect(signal.reason).toBeInstanceOf(SchedulerLeaseLostError);
      await expect(assertOwnership()).rejects.toBeInstanceOf(SchedulerLeaseLostError);
    },
  );
  await expect(
    runDueScheduledTasks(schedule, new Date(), { leaseStore: store, leaseMs: 100, renewalMs: 10 }),
  ).rejects.toBeInstanceOf(SchedulerLeaseLostError);
  expect(acknowledged).toBe(false);
  expect(released).toBe(true);
});

test("admission shutdown during a delayed claim releases it without invoking the task", async () => {
  mock.restore();
  const { Schedule, runDueScheduledTasks } = await import("@getstrata/core/scheduler/schedule");
  const admission = new AbortController();
  let ran = false;
  let released = false;
  const store = {
    acquire: async () => {
      admission.abort();
      return true;
    },
    renew: async () => true,
    complete: async () => true,
    release: async () => {
      released = true;
    },
  };
  expect(
    await runDueScheduledTasks(
      new Schedule().command("* * * * *", "task", () => {
        ran = true;
      }),
      new Date(),
      { signal: admission.signal, leaseStore: store },
    ),
  ).toBe(0);
  expect(ran).toBe(false);
  expect(released).toBe(true);
});

test("Redis failure never silently executes through a local fallback", async () => {
  mock.restore();
  const { Schedule, runDueScheduledTasks } = await import("@getstrata/core/scheduler/schedule");
  let ran = false;
  const schedule = new Schedule().command("* * * * *", "task", () => {
    ran = true;
  });
  await expect(
    runDueScheduledTasks(schedule, new Date(), {
      coordination: "redis",
      redisUrl: "redis://127.0.0.1:1",
      leaseMs: 100,
      commandTimeoutMs: 20,
    }),
  ).rejects.toThrow();
  expect(ran).toBe(false);
  await expect(runDueScheduledTasks(schedule, new Date(NaN))).rejects.toThrow("date");
  await expect(runDueScheduledTasks(schedule, new Date(), { leaseMs: 99 })).rejects.toThrow(
    "leaseMs",
  );
  await expect(
    runDueScheduledTasks(schedule, new Date(), { leaseMs: 100, renewalMs: 50 }),
  ).rejects.toThrow("renewalMs");
});

test("invalid namespace and JavaScript task handlers fail before admission", async () => {
  mock.restore();
  const { Schedule, runDueScheduledTasks } = await import("@getstrata/core/scheduler/schedule");
  const schedule = new Schedule();
  expect(() => schedule.command("* * * * *", "invalid", null as never)).toThrow("handler");
  schedule.command("* * * * *", "task", () => {});
  await expect(runDueScheduledTasks(schedule, new Date(), { namespace: " " })).rejects.toThrow(
    "namespace",
  );
});
