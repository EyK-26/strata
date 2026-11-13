import { appLogger } from "../logging/logger";
import { Job, type JobContext } from "../queue";

interface ExportAuditLogsPayload {
  reason?: string;
}

class ExportAuditLogsJob extends Job<ExportAuditLogsPayload> {
  override readonly maxAttempts = 2;
  override readonly backoffMs = 5_000;

  constructor(private readonly exporter?: () => Promise<number>) {
    super();
  }

  override async handle(
    _payload: ExportAuditLogsPayload = {},
    context?: JobContext,
  ): Promise<void> {
    const exporter = this.exporter ?? context?.auditExport;
    if (!exporter) throw new Error("Audit export requires an application-owned exporter.");
    const exported = await exporter();

    if (exported > 0) {
      appLogger.info(`Exported ${exported} audit log entries to SIEM.`);
    }
  }
}

export { ExportAuditLogsJob };
export default ExportAuditLogsJob;
export type { ExportAuditLogsPayload };
