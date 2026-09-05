import type { AppModule } from "@getstrata/bootstrap/contracts";
import { notificationRoutes } from "./routes.ts";
import { notificationWebRoutes } from "./web.ts";

const notificationsModule: AppModule = {
  name: "notifications",
  order: 60,
  tableName: "notifications",
  routes({ dependencies }) {
    return notificationRoutes(dependencies);
  },
  webRoutes({ dependencies }) {
    return notificationWebRoutes(dependencies);
  },
};

export default notificationsModule;
