import type { AppModule } from "@getstrata/bootstrap/contracts";
import { offerRoutes } from "./routes.ts";
import { offerWebRoutes } from "./web.ts";

const offersModule: AppModule = {
  name: "offers",
  order: 47,
  tableName: "offers",
  routes({ dependencies }) {
    return offerRoutes(dependencies);
  },
  webRoutes({ dependencies }) {
    return offerWebRoutes(dependencies);
  },
};

export default offersModule;
