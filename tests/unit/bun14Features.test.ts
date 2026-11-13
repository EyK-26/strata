import { afterEach, describe, expect, mock, test } from "bun:test";
import { createApplication } from "@getstrata/core/runtime/application";
import { Schedule } from "@getstrata/core/scheduler/schedule";
import { createInProcessCronResource } from "../../src/bootstrap/inProcessCron";

describe("inProcessCron bootstrap", () => {
  test("native cron start/stop follows one canonical application owner", async () => {
    const descriptor = createInProcessCronResource(new Schedule(), {
      coordination: "single-runner",
      redisUrl: "",
      namespace: "test:schedule",
    });
    const app = createApplication({
      providers: [
        {
          name: "cron",
          async setup(scope) {
            await scope.acquire(descriptor);
          },
        },
      ],
    });
    expect(app.state.phase).toBe("constructed");
    const first = app.start();
    expect(app.start()).toBe(first);
    await first;
    const stopped = await app.stop();
    expect(stopped.successful).toBe(true);
    expect(await app.stop()).toBe(stopped);
  });
  test("cron refuses implicit coordination or namespace before native acquisition", () => {
    expect(() => createInProcessCronResource(new Schedule(), {})).toThrow("must be explicit");
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
