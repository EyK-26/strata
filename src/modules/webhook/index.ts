import { type AppModule } from "../../bootstrap/contracts";
import webhookProvider, { webhookServiceToken } from "./provider";
import { createWebhookRoutes } from "./routes";

const webhookModule: AppModule = {
  name: "webhook",
  order: 56,
  tableName: "webhook",
  providers: [webhookProvider],
  routes({ dependencies, kernel }) {
    return createWebhookRoutes(dependencies, kernel);
  },
};

export default webhookModule;
export { webhookProvider, webhookServiceToken };
