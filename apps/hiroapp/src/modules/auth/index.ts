import type { AppModule } from "@getstrata/bootstrap/contracts";
import { authRoutes } from "./routes.ts";
import { authWebRoutes } from "./web.ts";

const authModule: AppModule = {
  name: "auth",
  order: 10,
  routes({ dependencies }) {
    return authRoutes(dependencies);
  },
  webRoutes({ dependencies }) {
    return authWebRoutes(dependencies);
  },
};

export default authModule;
