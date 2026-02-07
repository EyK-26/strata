import type { AppDependencies, CachedJson } from "../../bootstrap/contracts";
import CharacterController from "./controller";

function createCharacterRoutes(
  dependencies: AppDependencies,
  cachedJson: CachedJson,
) {
  const controller = new CharacterController(dependencies, cachedJson);

  return {
    "/characters": controller.index,
    "/characters/:id": controller.show,
    "/characters-formatted": controller.formattedIndex,
  };
}

export { createCharacterRoutes };
