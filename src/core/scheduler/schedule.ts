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
): Promise<number> {
  const due = schedule.dueTasks(now);

  for (const task of due) {
    await task.run();
  }

  return due.length;
}

export type { ScheduledTask };
export { appSchedule, runDueScheduledTasks, Schedule };
