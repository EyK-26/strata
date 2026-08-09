import { afterEach, describe, expect, mock, test } from "bun:test";
import { captureConsole } from "./helpers";

afterEach(() => {
  mock.restore();
});

describe("scheduleRunCommand", () => {
  test("prints a message when no tasks are due", async () => {
    mock.module("../../../src/core/scheduler/schedule", () => ({
      appSchedule: {
        dueTasks: () => [],
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

    expect(output.logs).toEqual(["No scheduled tasks due."]);
  });

  test("runs due scheduled tasks", async () => {
    let ran = false;

    mock.module("../../../src/core/scheduler/schedule", () => ({
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
