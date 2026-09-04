import type { AppModule } from "@getstrata/bootstrap/contracts";
import { applicationRoutes } from "./routes.ts";

const applicationsModule: AppModule = {
  name: "applications",
  order: 40,
  tableName: "applications",
  routes({ dependencies }) {
    return applicationRoutes(dependencies);
  },
};

export default applicationsModule;
