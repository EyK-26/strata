import { appSchedule, runDueScheduledTasks } from "@getstrata/core/scheduler/schedule";

type LoadAppSchedule = () => void | Promise<void>;
type CloseScheduledApp = () => void | Promise<void>;

function createScheduleRunCommand(loadSchedule: LoadAppSchedule, close?: CloseScheduledApp) {
  return async function scheduleRunCommand(): Promise<void> {
    let failed = false;
    let failure: unknown;
    try {
      await loadSchedule();
      const due = appSchedule.dueTasks();
      if (due.length === 0) console.log("No scheduled tasks due.");
      else {
        for (const task of due) console.log(`Running scheduled task: ${task.name}`);
        await runDueScheduledTasks(appSchedule);
      }
    } catch (error) {
      failed = true;
      failure = error;
    }
    try {
      await close?.();
    } catch (error) {
      if (failed)
        throw new AggregateError(
          [failure, error],
          "Scheduler startup/runtime and cleanup failed.",
          { cause: failure },
        );
      throw error;
    }
    if (failed) throw failure;
  };
}

export type { CloseScheduledApp, LoadAppSchedule };
export { createScheduleRunCommand };
