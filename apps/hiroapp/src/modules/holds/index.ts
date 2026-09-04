import type { AppModule } from "@getstrata/bootstrap/contracts";
import { holdRoutes } from "./routes.ts";
import { holdWebRoutes } from "./web.ts";

const holdsModule: AppModule = {
  name: "holds",
  order: 61,
  tableName: "application_holds",
  routes({ dependencies }) {
    return holdRoutes(dependencies);
  },
  webRoutes({ dependencies }) {
    return holdWebRoutes(dependencies);
  },
};

export default holdsModule;
