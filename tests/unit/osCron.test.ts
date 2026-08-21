import { describe, expect, test } from "bun:test";
import {
  DEFAULT_SCHEDULE_RUN_EXPRESSION,
  OS_CRON_JOB_TITLE,
  parseScheduleExpression,
} from "@getstrata/core/scheduler/osCron";

describe("osCron helpers", () => {
  test("parseScheduleExpression returns the next fire time", () => {
    const next = parseScheduleExpression(
      DEFAULT_SCHEDULE_RUN_EXPRESSION,
      new Date("2026-01-01T12:34:56Z"),
    );

    expect(next).toBeInstanceOf(Date);
    expect(next?.getTime()).toBeGreaterThan(Date.parse("2026-01-01T12:34:56Z"));
  });

  test("exports stable OS cron metadata", () => {
    expect(OS_CRON_JOB_TITLE).toBe("getstrata-schedule-run");
    expect(DEFAULT_SCHEDULE_RUN_EXPRESSION).toBe("* * * * *");
  });
});

describe("registerInProcessScheduleRunner", () => {
  test("registers and stops an in-process cron job", async () => {
    const { registerInProcessScheduleRunner } = await import("@getstrata/core/scheduler/osCron");
    let runs = 0;

    const job = registerInProcessScheduleRunner(async () => {
      runs += 1;
    }, "@hourly");

    expect(job.cron).toBe("@hourly");
    job.stop();
    expect(runs).toBe(0);
  });
});
