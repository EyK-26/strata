import { assertScheduleExpression, isScheduleExpressionDue } from "./osCron";

type ScheduledTask = {
  expression: string;
  name: string;
  run: () => void | Promise<void>;
};

class Schedule {
  private readonly tasks: ScheduledTask[] = [];

  command(expression: string, name: string, run: () => void | Promise<void>): this {
    assertScheduleExpression(expression);
    this.tasks.push({ expression, name, run });
    return this;
  }

  dueTasks(now = new Date()): ScheduledTask[] {
    return this.tasks.filter((task) => isScheduleExpressionDue(task.expression, now));
  }

  tasksList(): ScheduledTask[] {
    return [...this.tasks];
  }
}

const appSchedule = new Schedule();

async function runDueScheduledTasks(
  schedule: Schedule = appSchedule,
  now = new Date(),
  options: { signal?: AbortSignal } = {},
): Promise<number> {
  const due = schedule.dueTasks(now);

  let completed = 0;
  for (const task of due) {
    if (options.signal?.aborted) break;
    await task.run();
    completed++;
  }

  return completed;
}

export type { ScheduledTask };
export { appSchedule, runDueScheduledTasks, Schedule };
