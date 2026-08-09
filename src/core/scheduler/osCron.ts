const DEFAULT_SCHEDULE_RUN_EXPRESSION = "* * * * *";
const OS_CRON_JOB_TITLE = "getstrata-schedule-run";

interface InProcessCronJob {
  readonly cron: string;
  stop(): InProcessCronJob;
  ref(): InProcessCronJob;
  unref(): InProcessCronJob;
}

type RegisterInProcessCron = (
  schedule: string,
  handler: () => void | Promise<void>,
) => InProcessCronJob;

function parseScheduleExpression(expression: string, from: Date = new Date()): Date | null {
  return Bun.cron.parse(expression, from);
}

function minuteWindow(now: Date): { start: Date; end: Date } {
  const start = new Date(now);
  start.setSeconds(0, 0);

  return { start, end: new Date(start.getTime() + 60_000) };
}

function isScheduleExpressionDue(expression: string, now = new Date()): boolean {
  const { start, end } = minuteWindow(now);
  const next = parseScheduleExpression(expression, new Date(start.getTime() - 1));

  if (!next) {
    return false;
  }

  const timestamp = next.getTime();
  return timestamp >= start.getTime() && timestamp < end.getTime();
}

function assertScheduleExpression(expression: string): void {
  try {
    const next = parseScheduleExpression(expression);

    if (!(next instanceof Date) || Number.isNaN(next.getTime())) {
      throw new Error("unparsable");
    }
  } catch {
    throw new Error(`Unsupported schedule expression "${expression}".`);
  }
}

function registerInProcessScheduleRunner(
  run: () => void | Promise<void>,
  expression = DEFAULT_SCHEDULE_RUN_EXPRESSION,
): InProcessCronJob {
  const register = Bun.cron as unknown as RegisterInProcessCron;

  return register(expression, async () => {
    await run();
  }).unref();
}

async function installOsScheduleRunner(
  workerScriptPath: string,
  expression = DEFAULT_SCHEDULE_RUN_EXPRESSION,
  title = OS_CRON_JOB_TITLE,
): Promise<void> {
  await Bun.cron(workerScriptPath, expression, title);
}

async function uninstallOsScheduleRunner(title = OS_CRON_JOB_TITLE): Promise<void> {
  await Bun.cron.remove(title);
}

export type { InProcessCronJob };
export {
  assertScheduleExpression,
  DEFAULT_SCHEDULE_RUN_EXPRESSION,
  installOsScheduleRunner,
  isScheduleExpressionDue,
  OS_CRON_JOB_TITLE,
  parseScheduleExpression,
  registerInProcessScheduleRunner,
  uninstallOsScheduleRunner,
};
