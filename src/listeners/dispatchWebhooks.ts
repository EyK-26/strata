import { eventBus, modelEventName } from "@getstrata/core/events";
import { logSecurityEvent } from "@getstrata/core/security/securityEvents";
import { isFeatureEnabled } from "../config/features";
import { resolveApplicationDependencies } from "../core/runtime/applicationRegistry";
import { webhookServiceToken } from "../modules/webhook/provider";
import type WebhookService from "../modules/webhook/service";

const MODEL_ACTIONS = ["created", "updated", "deleted"] as const;
const MODEL_TABLES = ["organization", "project", "task", "comment"] as const;

async function dispatchModelWebhook(
  tableName: (typeof MODEL_TABLES)[number],
  action: (typeof MODEL_ACTIONS)[number],
  payload: unknown,
): Promise<void> {
  try {
    const dependencies = resolveApplicationDependencies();
    const webhookService = dependencies.container.resolve<WebhookService>(webhookServiceToken);

    await webhookService.dispatch(modelEventName(tableName, action), {
      table: tableName,
      action,
      payload,
    });
  } catch (error) {
    logSecurityEvent("webhook_dispatch_failed", {
      table: tableName,
      action,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function registerWebhookDispatchListeners(): void {
  if (!isFeatureEnabled("webhooks")) {
    return;
  }

  for (const tableName of MODEL_TABLES) {
    for (const action of MODEL_ACTIONS) {
      eventBus.listen(modelEventName(tableName, action), async (payload) => {
        await dispatchModelWebhook(tableName, action, payload);
      });
    }
  }
}

export default registerWebhookDispatchListeners;
export { dispatchModelWebhook };
