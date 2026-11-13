import type { ResourceSpec } from "@getstrata/core/contracts/application";
import {
  type InProcessCronJob,
  registerInProcessScheduleRunner,
} from "@getstrata/core/scheduler/osCron";
import {
  runDueScheduledTasks,
  type Schedule,
  type SchedulerRunOptions,
} from "@getstrata/core/scheduler/schedule";
/** Existing native cron adapter, with instance-owned admission and actual callback drain. */
export function createInProcessCronResource(
  schedule: Schedule,
  options: SchedulerRunOptions,
): ResourceSpec<InProcessCronJob> {
  if (!options.coordination || options.namespace === undefined || options.redisUrl === undefined)
    throw new TypeError("Cron coordination, namespace and Redis selection must be explicit.");
  const configured = Object.freeze({ ...options });
  const admission = new AbortController();
  const active = new Set<Promise<unknown>>();
  return {
    name: "scheduler.cron",
    open: () => ({
      ok: true,
      value: registerInProcessScheduleRunner(async () => {
        if (admission.signal.aborted) return;
        const running = runDueScheduledTasks(schedule, new Date(), {
          ...configured,
          signal: admission.signal,
        });
        active.add(running);
        try {
          await running;
        } finally {
          active.delete(running);
        }
      }),
    }),
    stop: (job) => {
      admission.abort();
      job.stop();
    },
    drain: async () => {
      await Promise.allSettled([...active]);
    },
    close: () => undefined,
  };
}
