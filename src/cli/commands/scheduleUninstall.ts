import { OS_CRON_JOB_TITLE, uninstallOsScheduleRunner } from "@getstrata/core/scheduler/osCron";

async function scheduleUninstallCommand(): Promise<void> {
  await uninstallOsScheduleRunner(OS_CRON_JOB_TITLE);
  console.log(`Removed OS cron job "${OS_CRON_JOB_TITLE}".`);
}

export { scheduleUninstallCommand };
