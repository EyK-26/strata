import { describe, expect, test } from "bun:test";
import {
  assertScheduleExpression,
  DEFAULT_SCHEDULE_RUN_EXPRESSION,
  isScheduleExpressionDue,
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

  test("isScheduleExpressionDue uses the current minute window", () => {
    expect(isScheduleExpressionDue("0 2 * * *", new Date("2026-01-01T02:00:30Z"))).toBe(true);
    expect(isScheduleExpressionDue("0 2 * * *", new Date("2026-01-01T02:01:00Z"))).toBe(false);
    expect(isScheduleExpressionDue("@hourly", new Date("2026-01-01T13:00:00Z"))).toBe(true);
  });

  test("assertScheduleExpression rejects invalid cron", () => {
    expect(() => assertScheduleExpression("* * * * *")).not.toThrow();
    expect(() => assertScheduleExpression("0 2 * *")).toThrow(/Unsupported schedule expression/);
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
