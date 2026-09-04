import type { AppModule } from "@getstrata/bootstrap/contracts";
import { careerRoutes } from "./routes.ts";
import { careerWebRoutes } from "./web.ts";

const careersModule: AppModule = {
  name: "careers",
  order: 59,
  tableName: "career_postings",
  routes({ dependencies }) {
    return careerRoutes(dependencies);
  },
  webRoutes({ dependencies }) {
    return careerWebRoutes(dependencies);
  },
};

export default careersModule;
