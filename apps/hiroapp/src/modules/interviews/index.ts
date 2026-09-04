import type { AppModule } from "@getstrata/bootstrap/contracts";
import { interviewRoutes } from "./routes.ts";
import { interviewWebRoutes } from "./web.ts";

const interviewsModule: AppModule = {
  name: "interviews",
  order: 45,
  tableName: "interviews",
  routes({ dependencies }) {
    return interviewRoutes(dependencies);
  },
  webRoutes({ dependencies }) {
    return interviewWebRoutes(dependencies);
  },
};

export default interviewsModule;
