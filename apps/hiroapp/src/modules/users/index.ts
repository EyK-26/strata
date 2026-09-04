import type { AppModule } from "@getstrata/bootstrap/contracts";
import { userRoutes } from "./routes.ts";

const usersModule: AppModule = {
  name: "users",
  order: 20,
  tableName: "users",
  routes({ dependencies }) {
    return userRoutes(dependencies);
  },
};

export default usersModule;
