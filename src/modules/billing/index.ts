import type { AppModule } from "../../bootstrap/contracts";
import { isFeatureEnabled } from "../../config/features";
import billingProvider, { billingServiceToken } from "./provider";
import { createBillingRoutes } from "./routes";

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
};

export default billingModule;
export { billingProvider, billingServiceToken };
