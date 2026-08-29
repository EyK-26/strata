import type { AppModule } from "@getstrata/bootstrap/contracts";
import { isFeatureEnabled } from "../../config/features";
import searchProvider, { searchServiceToken } from "./provider";
import { createSearchRoutes } from "./routes";
import { createSearchWebRoutes } from "./webController";

const searchModule: AppModule = {
  name: "search",
  order: 57,
  providers: [searchProvider],
  routes({ dependencies, kernel }) {
    if (!isFeatureEnabled("fullTextSearch")) {
      return {};
    }

    return createSearchRoutes(dependencies, kernel);
  },
  webRoutes({ dependencies, kernel }) {
    if (!isFeatureEnabled("fullTextSearch")) {
      return {};
    }

    return createSearchWebRoutes(dependencies, kernel);
  },
};

export default searchModule;
export { searchProvider, searchServiceToken };
