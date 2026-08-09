import type { AppDependencies, CachedJson } from "@getstrata/bootstrap/contracts";
import type { HttpKernel } from "@getstrata/bootstrap/httpKernel";
import type { RouteHandler } from "@getstrata/core/http/middleware";
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
