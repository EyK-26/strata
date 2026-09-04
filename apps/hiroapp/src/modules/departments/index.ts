import type { AppModule } from "@getstrata/bootstrap/contracts";
import { departmentRoutes } from "./routes.ts";
import { departmentWebRoutes } from "./web.ts";

const departmentsModule: AppModule = {
  name: "departments",
  order: 50,
  tableName: "departments",
  routes({ dependencies }) {
    return departmentRoutes(dependencies);
  },
  webRoutes({ dependencies }) {
    return departmentWebRoutes(dependencies);
  },
};

export default departmentsModule;
