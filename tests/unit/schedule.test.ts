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
