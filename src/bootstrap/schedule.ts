import { ExportAuditLogsJob } from "@getstrata/core/jobs/exportAuditLogsJob";
import { appLogger } from "@getstrata/core/logging/logger";
import { appSchedule } from "@getstrata/core/scheduler/schedule";
import { isFeatureEnabled } from "../config/features";

appSchedule.command("* * * * *", "heartbeat", () => {
  appLogger.debug("Scheduler heartbeat");
});

appSchedule.command("* * * * *", "audit-export", async () => {
  if (!isFeatureEnabled("siemExport")) {
    return;
  }

  try {
    await new ExportAuditLogsJob().handle({});
  } catch (error) {
    appLogger.error("Audit export failed.", { error: String(error) });
  }
});

export { appSchedule };
