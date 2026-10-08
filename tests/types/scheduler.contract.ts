/** Compiled against source and packed exports; never executed. */
import { Schedule, type SchedulerLeaseStore, type SchedulerRunOptions } from "@getstrata/core";
import { runDueScheduledTasks } from "@getstrata/core/scheduler/schedule";
export async function schedulerContracts(store: SchedulerLeaseStore): Promise<void> {
  const schedule = new Schedule().command("* * * * *", "task", async (context) => {
    const identity: string = context.occurrenceId;
    const when: Date = context.scheduledAt;
    const signal: AbortSignal = context.signal;
    await context.assertOwnership();
    void [identity, when, signal];
  });
  schedule.command("* * * * *", "legacy", () => {});
  const options: SchedulerRunOptions = {
    coordination: "redis",
    leaseStore: store,
    leaseMs: 30_000,
  };
  const completed: number = await runDueScheduledTasks(schedule, new Date(), options);
  // @ts-expect-error Unsupported coordination mode.
  await runDueScheduledTasks(schedule, new Date(), { coordination: "fallback" });
  // @ts-expect-error Lease durations are numbers.
  await runDueScheduledTasks(schedule, new Date(), { leaseMs: "30000" });
  void completed;
}
