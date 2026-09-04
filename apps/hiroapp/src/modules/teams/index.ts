import type { AppModule } from "@getstrata/bootstrap/contracts";
import { teamRoutes } from "./routes.ts";

const teamsModule: AppModule = {
  name: "teams",
  order: 55,
  routes({ dependencies }) {
    return teamRoutes(dependencies);
  },
};

export default teamsModule;
