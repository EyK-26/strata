import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import * as database from "../../../src/db/connection";
import { captureConsole } from "./helpers";

beforeEach(() => {
  spyOn(database, "closeDatabase").mockResolvedValue(undefined);
});

afterEach(() => {
  mock.restore();
});

describe("scheduleRunCommand", () => {
  test("prints a message when no tasks are due", async () => {
    mock.module("@getstrata/core/scheduler/schedule", () => ({
      appSchedule: {
        dueTasks: () => [],
      },
      runDueScheduledTasks: async () => undefined,
    }));
    mock.module("../../../src/bootstrap/schedule", () => ({}));

    const { scheduleRunCommand } = await import("../../../src/cli/commands/scheduleRun");
    const output = captureConsole();

    try {
      await scheduleRunCommand();
    } finally {
      output.restore();
    }

    expect(output.logs).toEqual(["No scheduled tasks due."]);
  });

  test("runs due scheduled tasks", async () => {
    let ran = false;

    mock.module("@getstrata/core/scheduler/schedule", () => ({
      appSchedule: {
        dueTasks: () => [
          {
            name: "heartbeat",
            run: async () => {
              ran = true;
            },
          },
        ],
      },
      runDueScheduledTasks: async (schedule: {
        dueTasks: () => Array<{ run: () => Promise<void> }>;
      }) => {
        for (const task of schedule.dueTasks()) await task.run();
      },
    }));
    mock.module("../../../src/bootstrap/schedule", () => ({}));

    const { scheduleRunCommand } = await import("../../../src/cli/commands/scheduleRun");
    const output = captureConsole();

    try {
      await scheduleRunCommand();
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
    mock.module("@getstrata/core/scheduler/schedule", () => ({
      appSchedule: {
        dueTasks: () => {
          inspected++;
          return [{ name: "probe" }];
        },
      },
      runDueScheduledTasks: async () => {
        ran++;
      },
    }));
    const { createScheduleRunCommand } = await import("@getstrata/cli/schedule");
    const running = createScheduleRunCommand(
      () => gate,
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
