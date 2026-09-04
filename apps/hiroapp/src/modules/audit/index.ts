import type { AppModule } from "@getstrata/bootstrap/contracts";
import { auditRoutes } from "./routes.ts";
import { auditWebRoutes } from "./web.ts";

const auditModule: AppModule = {
  name: "audit",
  order: 72,
  routes({ dependencies }) {
    return auditRoutes(dependencies);
  },
  webRoutes({ dependencies }) {
    return auditWebRoutes(dependencies);
  },
};

export default auditModule;
