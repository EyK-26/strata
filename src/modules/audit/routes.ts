import type { HttpKernel } from "../../bootstrap/httpKernel";
import type { AppDependencies } from "../../bootstrap/contracts";
import type { RouteHandler } from "../../core/http/middleware";
import AuditController from "./controller";

function createAuditRoutes(dependencies: AppDependencies, kernel: HttpKernel) {
  const controller = new AuditController(dependencies);

  return {
    "/audit-logs": {
      GET: kernel.wrapAbility("audit:read", controller.index as unknown as RouteHandler),
    },
  };
}

export { createAuditRoutes };
