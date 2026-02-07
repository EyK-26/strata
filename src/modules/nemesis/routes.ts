import type { AppDependencies, CachedJson } from "../../bootstrap/contracts";
import NemesisController from "./controller";

function createNemesisRoutes(
  dependencies: AppDependencies,
  cachedJson: CachedJson,
) {
  const controller = new NemesisController(dependencies, cachedJson);

  return {
    "/nemesis": controller.index,
    "/nemesis/:id": controller.show,
    "/nemesis/character/:id": controller.byCharacter,
  };
}

export { createNemesisRoutes };
