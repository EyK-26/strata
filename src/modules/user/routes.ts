import type { HttpKernel } from "@getstrata/bootstrap/httpKernel";
import type { AppDependencies } from "@getstrata/core/contracts/di";
import type { RouteHandler } from "@getstrata/core/http/middleware";
import { isFeatureEnabled } from "../../config/features";
import AuthController from "./controller";

function createAuthRoutes(dependencies: AppDependencies, kernel: HttpKernel) {
  const controller = new AuthController(dependencies);

  return {
    "/auth/login": {
      POST: kernel.wrapLogin(controller.login),
    },
    ...(isFeatureEnabled("registration")
      ? {
          "/auth/register": {
            POST: kernel.wrapRegister(controller.register as unknown as RouteHandler),
          },
        }
      : {}),
    "/auth/oauth/:provider": {
      GET: controller.oauthRedirect,
    },
    "/auth/oauth/:provider/callback": {
      GET: controller.oauthCallback,
    },
    "/auth/me": {
      GET: kernel.wrapAuthenticated(controller.me as unknown as RouteHandler),
    },
    "/users/me/export": {
      GET: kernel.wrapAuthenticated(controller.exportMe as unknown as RouteHandler),
    },
    "/users/me": {
      DELETE: kernel.wrapAuthenticated(controller.deleteMe as unknown as RouteHandler),
    },
    "/auth/tokens": {
      GET: kernel.wrapAbility("auth:tokens:read", controller.listTokens as unknown as RouteHandler),
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
    "/users/me/notifications": {
      GET: kernel.wrapAuthenticated(controller.listNotifications as unknown as RouteHandler),
      PATCH: kernel.wrapAuthenticated(
        controller.markAllNotificationsRead as unknown as RouteHandler,
      ),
    },
    "/users/me/notifications/:id/read": {
      PATCH: kernel.wrapAuthenticated(controller.markNotificationRead as unknown as RouteHandler),
    },
  };
}

export { createAuthRoutes };
