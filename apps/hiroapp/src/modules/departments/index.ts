import type { AppModule } from "@getstrata/bootstrap/contracts";
import { departmentRoutes } from "./routes.ts";

const departmentsModule: AppModule = {
  name: "departments",
  order: 50,
  tableName: "departments",
  routes({ dependencies }) {
    return departmentRoutes(dependencies);
  },
};

export default departmentsModule;
