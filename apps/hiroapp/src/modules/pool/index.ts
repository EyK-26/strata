import type { AppModule } from "@getstrata/bootstrap/contracts";
import { talentPoolRoutes } from "./routes.ts";
import { talentPoolWebRoutes } from "./web.ts";

const talentPoolModule: AppModule = {
  name: "pool",
  order: 52,
  tableName: "talent_pool_entries",
  routes({ dependencies }) {
    return talentPoolRoutes(dependencies);
  },
  webRoutes({ dependencies }) {
    return talentPoolWebRoutes(dependencies);
  },
};

export default talentPoolModule;
