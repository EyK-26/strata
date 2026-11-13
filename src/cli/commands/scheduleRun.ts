import { createScheduleRunCommand } from "@getstrata/cli/schedule";
import { createAuditExporter } from "@getstrata/core/audit/exportAuditLogs";
import { createAppSchedule } from "../../bootstrap/schedule";
import { bootQueueApplication } from "./queueApplication";

async function scheduleRunCommand(): Promise<void> {
  const environment = Object.freeze({ ...process.env });
  let app: Awaited<ReturnType<typeof bootQueueApplication>> | undefined;
  await createScheduleRunCommand(
    async () => {
      app = await bootQueueApplication(false);
      const invoke = app.context.invoke;
      const auditExport = createAuditExporter({
        environment,
        runSql: (work) =>
          invoke(
            { kind: "command", actor: { kind: "system", policy: "audit.export" } },
            ({ database, policy }) =>
              environment.TENANCY_DRIVER === "rls"
                ? policy.run(database, { kind: "bypass" }, work)
                : database.transaction(work),
          ),
      });
      return createAppSchedule({
        environment,
        auditExport,
        invoke: (envelope, work) => invoke(envelope, () => work()),
      });
    },
    async () => {
      const result = await app?.application.stop();
      if (result && !result.successful)
        throw Error("Schedule application shutdown did not complete cleanly.");
    },
  )();
}

export { scheduleRunCommand };
