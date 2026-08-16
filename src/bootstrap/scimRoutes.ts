import { createScimAuthMiddleware } from "@getstrata/core/auth/scimAuthMiddleware";
import type { RouteHandler } from "@getstrata/core/http/middleware";
import { withMiddleware } from "@getstrata/core/http/routeMiddleware";
import { createScimThrottleMiddleware } from "@getstrata/core/http/scimThrottleMiddleware";
import ScimController from "../modules/scim/controller";
import type { AppDependencies } from "./contracts";

function createScimRoutes(dependencies: AppDependencies) {
  const redisUrl = process.env.REDIS_URL?.trim() ?? "";

  const secured = withMiddleware(
    createScimThrottleMiddleware({
      redisUrl: redisUrl || undefined,
      maxAttempts: Number(process.env.SCIM_RATE_LIMIT_PER_MINUTE ?? "60"),
      decaySeconds: 60,
    }),
    createScimAuthMiddleware(),
  );

  const bind = (method: (controller: ScimController) => RouteHandler): RouteHandler => {
    return secured(async (request: Request) => {
      const controller = new ScimController(dependencies);
      return await method(controller)(request);
    });
  };

  return {
    "/scim/v2/ServiceProviderConfig": {
      GET: bind((controller) => controller.serviceProviderConfig),
    },
    "/scim/v2/Users": {
      GET: bind((controller) => controller.listUsers),
      POST: bind((controller) => controller.createUser),
    },
    "/scim/v2/Users/:id": {
      GET: bind((controller) => controller.showUser),
      PATCH: bind((controller) => controller.patchUser),
      DELETE: bind((controller) => controller.deleteUser),
    },
    "/scim/v2/Groups": {
      GET: bind((controller) => controller.listGroups),
    },
    "/scim/v2/Groups/:id": {
      GET: bind((controller) => controller.showGroup),
      PATCH: bind((controller) => controller.patchGroup),
    },
  };
}

export { createScimRoutes };
