import type { AppModule } from "@getstrata/bootstrap/contracts";
import { notificationRoutes } from "./routes.ts";

const notificationsModule: AppModule = {
  name: "notifications",
  order: 60,
  tableName: "notifications",
  routes({ dependencies }) {
    return notificationRoutes(dependencies);
  },
};

export default notificationsModule;
