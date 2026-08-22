import { afterEach, describe, expect, mock, test } from "bun:test";
import { startInProcessCronIfEnabled, stopInProcessCron } from "../../src/bootstrap/inProcessCron";
import { restoreEnvVar } from "../helpers/restoreEnv";

describe("inProcessCron bootstrap", () => {
  test("starts and stops when SCHEDULER_DRIVER=in-process-cron", async () => {
    const previous = process.env.SCHEDULER_DRIVER;
    process.env.SCHEDULER_DRIVER = "in-process-cron";

    try {
      startInProcessCronIfEnabled();
      startInProcessCronIfEnabled();
      stopInProcessCron();
    } finally {
      restoreEnvVar("SCHEDULER_DRIVER", previous);
    }
  });

  test("no-ops for other scheduler drivers", () => {
    const previous = process.env.SCHEDULER_DRIVER;
    process.env.SCHEDULER_DRIVER = "external";

    try {
      expect(() => startInProcessCronIfEnabled()).not.toThrow();
      stopInProcessCron();
    } finally {
      restoreEnvVar("SCHEDULER_DRIVER", previous);
    }
  });
});

describe("Bun 1.4 dependency tooling scripts", () => {
  test("package.json exposes dedupe and audit helpers", async () => {
    const pkg = await Bun.file(new URL("../../package.json", import.meta.url)).json();
    expect(pkg.scripts["deps:dedupe"]).toBe("bun dedupe");
    expect(pkg.scripts["deps:audit"]).toBe("bun audit");
    expect(pkg.scripts["deps:audit-fix"]).toBe("bun audit fix");
    expect(pkg.scripts["test:parallel"]).toBe("scripts/test-parallel.sh");
  });
});

describe("schedule install commands", () => {
  afterEach(() => {
    mock.restore();
  });

  test("scheduleInstallCommand registers an OS cron job", async () => {
    const install = mock(async () => undefined);
    mock.module("@getstrata/core/scheduler/osCron", () => ({
      DEFAULT_SCHEDULE_RUN_EXPRESSION: "* * * * *",
      OS_CRON_JOB_TITLE: "getstrata-schedule-run",
      installOsScheduleRunner: install,
    }));

    const { scheduleInstallCommand } = await import("../../src/cli/commands/scheduleInstall.ts");
    await scheduleInstallCommand();

    expect(install).toHaveBeenCalledTimes(1);
  });

  test("scheduleUninstallCommand removes the OS cron job", async () => {
    const uninstall = mock(async () => undefined);
    mock.module("@getstrata/core/scheduler/osCron", () => ({
      OS_CRON_JOB_TITLE: "getstrata-schedule-run",
      uninstallOsScheduleRunner: uninstall,
    }));

    const { scheduleUninstallCommand } = await import(
      "../../src/cli/commands/scheduleUninstall.ts"
    );
    await scheduleUninstallCommand();

    expect(uninstall).toHaveBeenCalledTimes(1);
  });
});
