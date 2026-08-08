import type { HttpKernel } from "../../bootstrap/httpKernel";
import type { AppDependencies } from "../../bootstrap/contracts";
import type { RouteHandler } from "../../core/http/middleware";
import AuthController from "./controller";

function createAuthRoutes(dependencies: AppDependencies, kernel: HttpKernel) {
  const controller = new AuthController(dependencies);

  return {
    "/auth/me": kernel.wrapAuthenticated(
      controller.me as unknown as RouteHandler,
    ),
  };
}

export { createAuthRoutes };
