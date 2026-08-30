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
    expect(() => schedule.command("0 2 * * *", "nightly", () => undefined)).toThrow(
      /Unsupported schedule expression/,
    );
  });
});
