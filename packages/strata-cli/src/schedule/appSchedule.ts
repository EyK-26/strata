import { appSchedule, runDueScheduledTasks } from "@getstrata/core/scheduler/schedule";

type LoadAppSchedule = () => void | Promise<void>;

function createScheduleRunCommand(loadSchedule: LoadAppSchedule) {
  return async function scheduleRunCommand(): Promise<void> {
    await loadSchedule();

    const due = appSchedule.dueTasks();

    if (due.length === 0) {
      console.log("No scheduled tasks due.");
      return;
    }

    for (const task of due) {
      console.log(`Running scheduled task: ${task.name}`);
    }

    await runDueScheduledTasks(appSchedule);
  };
}

export type { LoadAppSchedule };
export { createScheduleRunCommand };
