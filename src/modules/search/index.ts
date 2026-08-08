import { type AppModule } from "../../bootstrap/contracts";
import searchProvider, { searchServiceToken } from "./provider";
import { createSearchRoutes } from "./routes";

const searchModule: AppModule = {
  name: "search",
  order: 57,
  providers: [searchProvider],
  routes({ dependencies, kernel }) {
    return createSearchRoutes(dependencies, kernel);
  },
};

export default searchModule;
export { searchProvider, searchServiceToken };
