type ScheduledTask = {
  expression: string;
  name: string;
  run: () => void | Promise<void>;
};

function isSupportedScheduleExpression(expression: string): boolean {
  if (expression === "* * * * *") {
    return true;
  }

  return /^(\*\/\d+)( \*){4}$/.test(expression);
}

class Schedule {
  private readonly tasks: ScheduledTask[] = [];

  command(expression: string, name: string, run: () => void | Promise<void>): this {
    if (!isSupportedScheduleExpression(expression)) {
      throw new Error(
        `Unsupported schedule expression "${expression}". Only "* * * * *" and "*/N * * * *" are implemented.`,
      );
    }

    this.tasks.push({ expression, name, run });
    return this;
  }

  dueTasks(now = new Date()): ScheduledTask[] {
    const minute = now.getMinutes();

    return this.tasks.filter((task) => {
      if (task.expression === "* * * * *") {
        return true;
      }

      const intervalMatch = task.expression.match(/^\*\/(\d+)(?: \*){4}$/);

      if (intervalMatch) {
        const interval = Number.parseInt(intervalMatch[1] ?? "", 10);
        return Number.isInteger(interval) && interval > 0 && minute % interval === 0;
      }

      return false;
    });
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
