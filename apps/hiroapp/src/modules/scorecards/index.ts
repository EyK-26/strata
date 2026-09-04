import type { AppModule } from "@getstrata/bootstrap/contracts";
import { scorecardRoutes } from "./routes.ts";
import { scorecardWebRoutes } from "./web.ts";

const scorecardsModule: AppModule = {
  name: "scorecards",
  order: 46,
  tableName: "interview_scorecards",
  routes({ dependencies }) {
    return scorecardRoutes(dependencies);
  },
  webRoutes({ dependencies }) {
    return scorecardWebRoutes(dependencies);
  },
};

export default scorecardsModule;
