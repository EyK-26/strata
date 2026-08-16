import { exportPendingAuditLogs } from "@getstrata/core/audit/exportAuditLogs";
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
    const exported = await exportPendingAuditLogs();

    if (exported > 0) {
      appLogger.info(`Exported ${exported} audit log entries to SIEM.`);
    }
  } catch (error) {
    appLogger.error("Audit export failed.", { error: String(error) });
  }
});
