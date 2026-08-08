import type { AppModule } from "../../bootstrap/contracts";
import { isFeatureEnabled } from "../../config/features";
import searchProvider, { searchServiceToken } from "./provider";
import { createSearchRoutes } from "./routes";

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
};

export default searchModule;
export { searchProvider, searchServiceToken };
