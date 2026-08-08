import type { AppDependencies, CachedJson } from "../../bootstrap/contracts";
import type { HttpKernel } from "../../bootstrap/httpKernel";
import type { RouteHandler } from "../../core/http/middleware";
import ReportController from "./controller";

function createReportRoutes(
  dependencies: AppDependencies,
  cachedJson: CachedJson,
  kernel: HttpKernel,
) {
  const controller = new ReportController(dependencies, cachedJson);

  return {
    "/reports/summary": kernel.wrapAuthenticated(controller.summary as unknown as RouteHandler),
    "/reports/organizations/:id": kernel.wrapAuthenticated(
      controller.organization as unknown as RouteHandler,
    ),
  };
}

export { createReportRoutes };
