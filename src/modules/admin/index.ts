import type { AppModule } from "../../bootstrap/contracts";
import adminProvider, { adminServiceToken } from "./provider";
import { createAdminRoutes } from "./routes";

const adminModule: AppModule = {
  name: "admin",
  order: 6,
  providers: [adminProvider],
  routes({ dependencies, kernel }) {
    return createAdminRoutes(dependencies, kernel);
  },
};

export default adminModule;
export { adminProvider, adminServiceToken };
