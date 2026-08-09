import { fileURLToPath } from "node:url";
import {
  DEFAULT_SCHEDULE_RUN_EXPRESSION,
  installOsScheduleRunner,
  OS_CRON_JOB_TITLE,
} from "@getstrata/core/scheduler/osCron";

async function scheduleInstallCommand(): Promise<void> {
  const workerPath = fileURLToPath(new URL("../cron/scheduleRunWorker.ts", import.meta.url));

  await installOsScheduleRunner(workerPath, DEFAULT_SCHEDULE_RUN_EXPRESSION, OS_CRON_JOB_TITLE);

  console.log(
    `Installed OS cron job "${OS_CRON_JOB_TITLE}" (${DEFAULT_SCHEDULE_RUN_EXPRESSION}) -> ${workerPath}`,
  );
}

export { scheduleInstallCommand };
