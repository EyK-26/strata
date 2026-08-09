import type { AppModule } from "@getstrata/bootstrap/contracts";
import adminProvider, { adminServiceToken } from "./provider";
import { createAdminRoutes } from "./routes";
import { createAdminWebRoutes } from "./webRoutes";

const adminModule: AppModule = {
  name: "admin",
  order: 6,
  providers: [adminProvider],
  routes({ dependencies, kernel }) {
    return createAdminRoutes(dependencies, kernel);
  },
  webRoutes({ dependencies, kernel }) {
    return createAdminWebRoutes(dependencies, kernel);
  },
};

export default adminModule;
export { adminProvider, adminServiceToken };
