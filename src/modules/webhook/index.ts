import type { AppModule } from "@getstrata/bootstrap/contracts";
import { isFeatureEnabled } from "../../config/features";
import webhookProvider, { webhookServiceToken } from "./provider";
import { createWebhookRoutes } from "./routes";
import { createWebhookWebRoutes } from "./webController";

const webhookModule: AppModule = {
  name: "webhook",
  order: 56,
  tableName: "webhook",
  providers: [webhookProvider],
  routes({ dependencies, kernel }) {
    if (!isFeatureEnabled("webhooks")) {
      return {};
    }

    return createWebhookRoutes(dependencies, kernel);
  },
  webRoutes({ dependencies, kernel }) {
    if (!isFeatureEnabled("webhooks")) {
      return {};
    }

    return createWebhookWebRoutes(dependencies, kernel);
  },
};

export default webhookModule;
export { webhookProvider, webhookServiceToken };
