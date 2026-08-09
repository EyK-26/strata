import { appSchedule, runDueScheduledTasks } from "../../core/scheduler/schedule";
import "../../bootstrap/schedule";

async function scheduleRunCommand(): Promise<void> {
  const due = appSchedule.dueTasks();

  if (due.length === 0) {
    console.log("No scheduled tasks due.");
    return;
  }

  for (const task of due) {
    console.log(`Running scheduled task: ${task.name}`);
  }

  await runDueScheduledTasks(appSchedule);
}

export { scheduleRunCommand };
