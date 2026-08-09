import type { InProcessCronJob } from "@getstrata/core/scheduler/osCron";
import { registerInProcessScheduleRunner } from "@getstrata/core/scheduler/osCron";
import { runDueScheduledTasks } from "@getstrata/core/scheduler/schedule";
import "./schedule";

let activeJob: InProcessCronJob | null = null;

function startInProcessCronIfEnabled(): void {
  if (process.env.SCHEDULER_DRIVER !== "in-process-cron") {
    return;
  }

  if (activeJob) {
    return;
  }

  activeJob = registerInProcessScheduleRunner(async () => {
    await runDueScheduledTasks();
  });
}

function stopInProcessCron(): void {
  activeJob?.stop();
  activeJob = null;
}

export { startInProcessCronIfEnabled, stopInProcessCron };
