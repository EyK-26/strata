import type { ExecutionEnvelope } from "@getstrata/core/contracts/application";
import { ExportAuditLogsJob } from "@getstrata/core/jobs/exportAuditLogsJob";
import { appLogger } from "@getstrata/core/logging/logger";
import { isProductionEnv } from "@getstrata/core/runtime/appEnv";
import { appKeyPrefix } from "@getstrata/core/runtime/appKeyPrefix";
import { Schedule } from "@getstrata/core/scheduler/schedule";

interface AppScheduleOptions {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly auditExport: () => Promise<number>;
  readonly invoke: <T>(envelope: ExecutionEnvelope, work: () => T | Promise<T>) => Promise<T>;
}
/** One schedule definition per application; actual tasks enter that owner's existing execution engine. */
export function createAppSchedule(options: AppScheduleOptions): Schedule {
  const enabled = options.environment.FEATURE_SIEM_EXPORT === "true";
  const schedule = new Schedule();
  const owned =
    (name: string, work: () => void | Promise<void>) =>
    async (context: import("@getstrata/core/scheduler/schedule").ScheduledTaskContext) =>
      options.invoke(
        {
          kind: "job",
          externalId: context.occurrenceId,
          signal: context.signal,
          actor: { kind: "system", policy: "scheduler.task" },
          metadata: { taskName: name },
        },
        work,
      );
  schedule.command(
    "* * * * *",
    "heartbeat",
    owned("heartbeat", () => {
      appLogger.debug("Scheduler heartbeat");
    }),
  );
  schedule.command(
    "* * * * *",
    "audit-export",
    owned("audit-export", async () => {
      if (!enabled) return;
      try {
        await new ExportAuditLogsJob(options.auditExport).handle({});
      } catch (error) {
        appLogger.error("Audit export failed.", { error: String(error) });
      }
    }),
  );
  return schedule;
}
export type { AppScheduleOptions };

export function createScheduleRunOptions(
  environment: Readonly<Record<string, string | undefined>>,
): import("@getstrata/core/scheduler/schedule").SchedulerRunOptions {
  const coordination =
    environment.SCHEDULER_COORDINATION ??
    (isProductionEnv(environment) ? "redis" : "single-runner");
  if (coordination !== "redis" && coordination !== "single-runner")
    throw new TypeError("Unsupported scheduler coordination.");
  return Object.freeze({
    coordination,
    redisUrl: environment.REDIS_URL?.trim() ?? "",
    namespace: appKeyPrefix(environment) + ":schedule",
  });
}
