import type { AppModule } from "@getstrata/bootstrap/contracts";
import { onboardingRoutes } from "./routes.ts";
import { onboardingWebRoutes } from "./web.ts";

const onboardingModule: AppModule = {
  name: "onboarding",
  order: 58,
  tableName: "onboarding_items",
  routes({ dependencies }) {
    return onboardingRoutes(dependencies);
  },
  webRoutes({ dependencies }) {
    return onboardingWebRoutes(dependencies);
  },
};

export default onboardingModule;
