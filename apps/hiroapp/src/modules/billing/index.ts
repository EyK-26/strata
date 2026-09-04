import type { AppModule } from "@getstrata/bootstrap/contracts";
import { billingRoutes } from "./routes.ts";
import { billingWebRoutes } from "./web.ts";

const billingModule: AppModule = {
  name: "billing",
  order: 76,
  routes({ dependencies }) {
    return billingRoutes(dependencies);
  },
  webRoutes({ dependencies }) {
    return billingWebRoutes(dependencies);
  },
};

export default billingModule;
