import type { AppModule } from "@getstrata/bootstrap/contracts";
import { requisitionRoutes } from "./routes.ts";
import { requisitionWebRoutes } from "./web.ts";

const requisitionsModule: AppModule = {
  name: "requisitions",
  order: 57,
  tableName: "position_requisitions",
  routes({ dependencies }) {
    return requisitionRoutes(dependencies);
  },
  webRoutes({ dependencies }) {
    return requisitionWebRoutes(dependencies);
  },
};

export default requisitionsModule;
