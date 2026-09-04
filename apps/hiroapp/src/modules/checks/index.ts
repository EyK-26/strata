import type { AppModule } from "@getstrata/bootstrap/contracts";
import { backgroundCheckRoutes } from "./routes.ts";
import { backgroundCheckWebRoutes } from "./web.ts";

const checksModule: AppModule = {
  name: "checks",
  order: 54,
  tableName: "background_checks",
  routes({ dependencies }) {
    return backgroundCheckRoutes(dependencies);
  },
  webRoutes({ dependencies }) {
    return backgroundCheckWebRoutes(dependencies);
  },
};

export default checksModule;
