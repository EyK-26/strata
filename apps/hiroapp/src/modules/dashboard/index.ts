import type { AppModule } from "@getstrata/bootstrap/contracts";
import { dashboardRoutes } from "./routes.ts";

const dashboardModule: AppModule = {
  name: "dashboard",
  order: 70,
  routes({ dependencies }) {
    return dashboardRoutes(dependencies);
  },
};

export default dashboardModule;
