import type { ServiceProvider } from "../../bootstrap/contracts";
import SearchService from "./service";

const searchServiceToken = "search.service";

const searchProvider: ServiceProvider = {
  name: "search.provider",
  register({ container }) {
    container.singleton(searchServiceToken, () => new SearchService());
  },
};

export default searchProvider;
export { searchServiceToken };
