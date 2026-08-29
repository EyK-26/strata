import type { AppModule } from "@getstrata/bootstrap/contracts";
import { isFeatureEnabled } from "../../config/features";
import billingProvider, { billingServiceToken } from "./provider";
import { createBillingRoutes } from "./routes";
import { createBillingWebRoutes } from "./webController";

const billingModule: AppModule = {
  name: "billing",
  order: 58,
  providers: [billingProvider],
  routes({ dependencies, kernel }) {
    if (!isFeatureEnabled("billing")) {
      return {};
    }

    return createBillingRoutes(dependencies, kernel);
  },
  webRoutes({ dependencies, kernel }) {
    if (!isFeatureEnabled("billing")) {
      return {};
    }

    return createBillingWebRoutes(dependencies, kernel);
  },
};

export default billingModule;
export { billingProvider, billingServiceToken };
