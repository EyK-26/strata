import { resolveApplicationDependencies } from "../bootstrap/applicationRegistry";
import { isFeatureEnabled } from "../config/features";
import { eventBus, modelEventName } from "../core/events";
import { webhookServiceToken } from "../modules/webhook/provider";
import type WebhookService from "../modules/webhook/service";

const MODEL_ACTIONS = ["created", "updated", "deleted"] as const;
const MODEL_TABLES = ["organization", "project", "task", "comment"] as const;

function registerWebhookDispatchListeners(): void {
  if (!isFeatureEnabled("webhooks")) {
    return;
  }

  for (const tableName of MODEL_TABLES) {
    for (const action of MODEL_ACTIONS) {
      eventBus.listen(modelEventName(tableName, action), async (payload) => {
        const dependencies = resolveApplicationDependencies();
        const webhookService = dependencies.container.resolve<WebhookService>(webhookServiceToken);

        await webhookService.dispatch(modelEventName(tableName, action), {
          table: tableName,
          action,
          payload,
        });
      });
    }
  }
}

export default registerWebhookDispatchListeners;
