import { describe, expect, test } from "bun:test";
import { Schedule } from "../../src/core/scheduler/schedule";

describe("Schedule", () => {
  test("returns every-minute tasks", () => {
    const schedule = new Schedule();
    schedule.command("* * * * *", "heartbeat", () => undefined);

    expect(schedule.dueTasks(new Date("2026-01-01T12:34:00Z"))).toHaveLength(1);
  });
});
