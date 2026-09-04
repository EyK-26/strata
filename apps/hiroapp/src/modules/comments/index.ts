import type { AppModule } from "@getstrata/bootstrap/contracts";
import { commentRoutes } from "./routes.ts";
import { commentWebRoutes } from "./web.ts";

const commentsModule: AppModule = {
  name: "comments",
  order: 56,
  tableName: "comments",
  routes({ dependencies }) {
    return commentRoutes(dependencies);
  },
  webRoutes({ dependencies }) {
    return commentWebRoutes(dependencies);
  },
};

export default commentsModule;
