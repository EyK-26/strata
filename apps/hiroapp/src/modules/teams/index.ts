import type { AppModule } from "@getstrata/bootstrap/contracts";
import { teamRoutes } from "./routes.ts";
import { teamWebRoutes } from "./web.ts";

const teamsModule: AppModule = {
  name: "teams",
  order: 55,
  routes({ dependencies }) {
    return teamRoutes(dependencies);
  },
  webRoutes({ dependencies }) {
    return teamWebRoutes(dependencies);
  },
};

export default teamsModule;
