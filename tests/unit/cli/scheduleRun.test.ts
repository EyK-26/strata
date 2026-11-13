import { describe, expect, test } from "bun:test";
import { createScheduleRunCommand } from "@getstrata/cli/schedule";
import { Schedule } from "@getstrata/core/scheduler/schedule";
import { captureConsole } from "./helpers";

describe("scheduleRunCommand", () => {
  test("prints a message when no tasks are due", async () => {
    const schedule = new Schedule();
    const output = captureConsole();
    try {
      await createScheduleRunCommand(() => schedule)();
    } finally {
      output.restore();
    }
    expect(output.logs).toEqual(["No scheduled tasks due."]);
  });

  test("runs due scheduled tasks", async () => {
    let ran = false;
    const schedule = new Schedule().command("* * * * *", "heartbeat", async () => {
      ran = true;
    });
    const output = captureConsole();
    try {
      await createScheduleRunCommand(() => schedule)();
    } finally {
      output.restore();
    }
    expect(ran).toBe(true);
    expect(output.logs).toEqual(["Running scheduled task: heartbeat"]);
  });
});

describe("scheduled app startup", () => {
  test("does not inspect or run tasks before boot resolves; rejected boot cleans up once", async () => {
    let inspected = 0;
    let ran = 0;
    let closed = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    class OwnedSchedule extends Schedule {
      override dueTasks(now = new Date()) {
        inspected++;
        return super.dueTasks(now);
      }
    }
    const schedule = new OwnedSchedule().command("* * * * *", "probe", async () => {
      ran++;
    });
    const running = createScheduleRunCommand(
      async () => {
        await gate;
        return schedule;
      },
      () => {
        closed++;
      },
    )();
    await Promise.resolve();
    expect(inspected).toBe(0);
    expect(ran).toBe(0);
    release();
    await running;
    expect(ran).toBe(1);
    expect(closed).toBe(1);
    await expect(
      createScheduleRunCommand(
        async () => {
          throw new Error("boot failed");
        },
        () => {
          closed++;
        },
      )(),
    ).rejects.toThrow("boot failed");
    expect(ran).toBe(1);
    expect(closed).toBe(2);
  });
});
