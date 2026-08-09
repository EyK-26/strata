import type { AppDependencies } from "@getstrata/bootstrap/contracts";
import type { HttpKernel } from "@getstrata/bootstrap/httpKernel";
import type { RouteHandler } from "@getstrata/core/http/middleware";
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
