import { exportPendingAuditLogs } from "../audit/exportAuditLogs";
import { appLogger } from "../logging/logger";
import { Job } from "../queue";

interface ExportAuditLogsPayload {
  reason?: string;
}

class ExportAuditLogsJob extends Job<ExportAuditLogsPayload> {
  override readonly maxAttempts = 2;
  override readonly backoffMs = 5_000;

  override async handle(_payload: ExportAuditLogsPayload = {}): Promise<void> {
    const exported = await exportPendingAuditLogs();

    if (exported > 0) {
      appLogger.info(`Exported ${exported} audit log entries to SIEM.`);
    }
  }
}

export { ExportAuditLogsJob };
export default ExportAuditLogsJob;
export type { ExportAuditLogsPayload };
