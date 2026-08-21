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
  DEFAULT_SCHEDULE_RUN_EXPRESSION,
  installOsScheduleRunner,
  OS_CRON_JOB_TITLE,
  parseScheduleExpression,
  registerInProcessScheduleRunner,
  uninstallOsScheduleRunner,
};
