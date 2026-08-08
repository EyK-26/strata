import type { HttpKernel } from "../../bootstrap/httpKernel";
import type { AppDependencies } from "../../bootstrap/contracts";
import type { RouteHandler } from "../../core/http/middleware";
import AuthController from "./controller";

function createAuthRoutes(dependencies: AppDependencies, kernel: HttpKernel) {
  const controller = new AuthController(dependencies);

  return {
    "/auth/login": {
      POST: controller.login,
    },
    "/auth/oauth/:provider": {
      GET: controller.oauthRedirect,
    },
    "/auth/oauth/:provider/callback": {
      GET: controller.oauthCallback,
    },
    "/auth/me": {
      GET: kernel.wrapAuthenticated(
        controller.me as unknown as RouteHandler,
      ),
    },
    "/users/me/export": {
      GET: kernel.wrapAuthenticated(
        controller.exportMe as unknown as RouteHandler,
      ),
    },
    "/auth/tokens": {
      GET: kernel.wrapAbility(
        "auth:tokens:read",
        controller.listTokens as unknown as RouteHandler,
      ),
      POST: kernel.wrapAbility(
        "auth:tokens:write",
        controller.storeToken as unknown as RouteHandler,
      ),
    },
    "/auth/tokens/:id": {
      DELETE: kernel.wrapAbility(
        "auth:tokens:delete",
        controller.destroyToken as unknown as RouteHandler,
      ),
    },
  };
}

export { createAuthRoutes };
