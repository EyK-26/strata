import type { AppDependencies, CachedJson } from "../../bootstrap/contracts";
import SecretController from "./controller";

function createSecretRoutes(
  dependencies: AppDependencies,
  cachedJson: CachedJson,
) {
  const controller = new SecretController(dependencies, cachedJson);

  return {
    "/secrets": controller.index,
    "/secrets/:id": controller.show,
    "/secrets/nemesis/:id": controller.byNemesis,
  };
}

export { createSecretRoutes };
