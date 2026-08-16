import type { AppDependencies } from "@getstrata/core/contracts/di";
import { resolveService } from "@getstrata/core/contracts/di";
import { jsonResponse, withErrorHandling } from "@getstrata/core/http";
import { auditServiceToken } from "./provider";
import type AuditService from "./service";

class AuditController {
  constructor(private readonly dependencies: AppDependencies) {}

  private get service(): AuditService {
    return resolveService(this.dependencies, auditServiceToken);
  }

  readonly index = withErrorHandling(async () => {
    const logs = await this.service.listRecent();
    return jsonResponse({
      data: logs.map((log) => ({
        id: log.id,
        user_id: log.user_id,
        action: log.action,
        subject_type: log.subject_type,
        subject_id: log.subject_id,
        payload: log.payload,
        created_at: log.created_at.toISOString(),
      })),
    });
  });
}

export default AuditController;
