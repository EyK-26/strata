import { isFeatureEnabled } from "../config/features";
import { eventBus, modelEventName } from "../core/events";
import { resolveApplicationDependencies } from "../core/runtime/applicationRegistry";
import { auditServiceToken } from "../modules/audit/provider";
import type AuditService from "../modules/audit/service";

const MODEL_ACTIONS = ["created", "updated", "deleted", "restored", "force-deleted"] as const;
const MODEL_TABLES = ["organization", "project", "task", "comment"] as const;

function registerAuditLogListeners(): void {
  if (!isFeatureEnabled("auditLog")) {
    return;
  }

  for (const tableName of MODEL_TABLES) {
    for (const action of MODEL_ACTIONS) {
      eventBus.listen(modelEventName(tableName, action), async (payload) => {
        const dependencies = resolveApplicationDependencies();
        const auditService = dependencies.container.resolve<AuditService>(auditServiceToken);

        await auditService.record({
          action: `${tableName}.${action}`,
          subjectType: tableName,
          subjectId:
            payload && typeof payload === "object" && "id" in payload
              ? Number((payload as { id: number }).id)
              : null,
          payload:
            payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {},
        });
      });
    }
  }
}

export default registerAuditLogListeners;
