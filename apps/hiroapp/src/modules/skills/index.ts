import type { AppModule } from "@getstrata/bootstrap/contracts";
import { skillRoutes } from "./routes.ts";
import { skillWebRoutes } from "./web.ts";

const skillsModule: AppModule = {
  name: "skills",
  order: 55,
  tableName: "skills",
  routes({ dependencies }) {
    return skillRoutes(dependencies);
  },
  webRoutes({ dependencies }) {
    return skillWebRoutes(dependencies);
  },
};

export default skillsModule;
