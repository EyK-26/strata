import type { AppModule } from "@getstrata/bootstrap/contracts";
import { sourceRoutes } from "./routes.ts";
import { sourceWebRoutes } from "./web.ts";

const sourcesModule: AppModule = {
  name: "sources",
  order: 50,
  tableName: "application_attributions",
  routes({ dependencies }) {
    return sourceRoutes(dependencies);
  },
  webRoutes({ dependencies }) {
    return sourceWebRoutes(dependencies);
  },
};

export default sourcesModule;
