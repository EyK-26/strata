import type { AppModule } from "@getstrata/bootstrap/contracts";
import { webhookRoutes } from "./routes.ts";
import { webhookWebRoutes } from "./web.ts";

const webhooksModule: AppModule = {
  name: "webhooks",
  order: 74,
  routes({ dependencies }) {
    return webhookRoutes(dependencies);
  },
  webRoutes({ dependencies }) {
    return webhookWebRoutes(dependencies);
  },
};

export default webhooksModule;
