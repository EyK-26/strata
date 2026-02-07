import {
  getRequiredDependency,
  type ServiceProvider,
} from "../../bootstrap/contracts";
import JSONTreeService from "./service";

const jsonTreeServiceToken = "tree.json-tree-service";

const treeProvider: ServiceProvider = {
  name: "tree.provider",
  boot({ container, dependencies }) {
    container.singleton(
      jsonTreeServiceToken,
      () =>
        new JSONTreeService(
          getRequiredDependency(dependencies, "characterRepository"),
          getRequiredDependency(dependencies, "statisticsService"),
          getRequiredDependency(dependencies, "characterService"),
        ),
    );

    dependencies.jsonTreeService = container.resolve(jsonTreeServiceToken);
  },
};

export default treeProvider;
export { jsonTreeServiceToken };
