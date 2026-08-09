import { describe, expect, mock, test } from "bun:test";

describe("Schedule", () => {
  test("returns every-minute tasks", async () => {
    mock.restore();

    const { Schedule } = await import("../../src/core/scheduler/schedule");
    const schedule = new Schedule();
    schedule.command("* * * * *", "heartbeat", () => undefined);

    expect(schedule.dueTasks(new Date("2026-01-01T12:34:00Z"))).toHaveLength(1);
  });
});
