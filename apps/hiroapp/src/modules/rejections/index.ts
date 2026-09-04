import type { AppModule } from "@getstrata/bootstrap/contracts";
import { rejectionRoutes } from "./routes.ts";
import { rejectionWebRoutes } from "./web.ts";

const rejectionsModule: AppModule = {
  name: "rejections",
  order: 48,
  tableName: "application_rejections",
  routes({ dependencies }) {
    return rejectionRoutes(dependencies);
  },
  webRoutes({ dependencies }) {
    return rejectionWebRoutes(dependencies);
  },
};

export default rejectionsModule;
