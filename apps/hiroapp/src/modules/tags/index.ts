import type { AppModule } from "@getstrata/bootstrap/contracts";
import { tagRoutes } from "./routes.ts";
import { tagWebRoutes } from "./web.ts";

const tagsModule: AppModule = {
  name: "tags",
  order: 62,
  tableName: "candidate_tags",
  routes({ dependencies }) {
    return tagRoutes(dependencies);
  },
  webRoutes({ dependencies }) {
    return tagWebRoutes(dependencies);
  },
};

export default tagsModule;
