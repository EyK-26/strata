type ScheduledTask = {
  expression: string;
  name: string;
  run: () => void | Promise<void>;
};

class Schedule {
  private readonly tasks: ScheduledTask[] = [];

  command(expression: string, name: string, run: () => void | Promise<void>): this {
    this.tasks.push({ expression, name, run });
    return this;
  }

  dueTasks(now = new Date()): ScheduledTask[] {
    const minute = now.getMinutes();

    return this.tasks.filter((task) => {
      if (task.expression === "* * * * *") {
        return true;
      }

      if (task.expression.startsWith("*/")) {
        const interval = Number.parseInt(task.expression.slice(2), 10);
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

export type { ScheduledTask };
export { appSchedule, Schedule };
