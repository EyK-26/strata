import type { InProcessCronJob } from "@getstrata/core/scheduler/osCron";
import { registerInProcessScheduleRunner } from "@getstrata/core/scheduler/osCron";
import { runDueScheduledTasks } from "@getstrata/core/scheduler/schedule";
import "./schedule";

let activeJob: InProcessCronJob | null = null;
let admission: AbortController | undefined;
const active = new Set<Promise<unknown>>();

function startInProcessCronIfEnabled(): void {
  if (process.env.SCHEDULER_DRIVER !== "in-process-cron" || activeJob) return;
  admission = new AbortController();
  const signal = admission.signal;
  activeJob = registerInProcessScheduleRunner(async () => {
    if (signal.aborted) return;
    const running = runDueScheduledTasks(undefined, undefined, { signal });
    active.add(running);
    try {
      await running;
    } finally {
      active.delete(running);
    }
  });
}
function stopInProcessCron(): void {
  admission?.abort();
  activeJob?.stop();
  activeJob = null;
}
async function drainInProcessCron(): Promise<void> {
  await Promise.allSettled([...active]);
}

export { drainInProcessCron, startInProcessCronIfEnabled, stopInProcessCron };
