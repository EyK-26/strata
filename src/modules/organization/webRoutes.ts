import type { AppDependencies } from "@getstrata/bootstrap/contracts";
import type { HttpKernel } from "@getstrata/bootstrap/httpKernel";
import type { RouteHandler } from "@getstrata/core/http/middleware";
import OrganizationWebController from "./webController";

function createOrganizationWebRoutes(dependencies: AppDependencies, kernel: HttpKernel) {
  const controller = new OrganizationWebController(dependencies);

  return {
    "/organizations": {
      GET: kernel.wrapWebPublicRead(controller.index as unknown as RouteHandler),
      POST: kernel.wrapWebAbility(
        "organizations:create",
        controller.store as unknown as RouteHandler,
      ),
    },
    "/organizations/:id": {
      GET: kernel.wrapWebPublicRead(controller.show as unknown as RouteHandler),
    },
  };
}

export { createOrganizationWebRoutes };
