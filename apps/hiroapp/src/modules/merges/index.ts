import type { AppModule } from "@getstrata/bootstrap/contracts";
import { mergeRoutes } from "./routes.ts";
import { mergeWebRoutes } from "./web.ts";

const mergesModule: AppModule = {
  name: "merges",
  order: 60,
  tableName: "candidate_merges",
  routes({ dependencies }) {
    return mergeRoutes(dependencies);
  },
  webRoutes({ dependencies }) {
    return mergeWebRoutes(dependencies);
  },
};

export default mergesModule;
