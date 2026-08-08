import type { AppDependencies, CachedJson } from "../../bootstrap/contracts";
import type { HttpKernel } from "../../bootstrap/httpKernel";
import ReportController from "./controller";

function createReportRoutes(
  dependencies: AppDependencies,
  cachedJson: CachedJson,
  _kernel: HttpKernel,
) {
  const controller = new ReportController(dependencies, cachedJson);

  return {
    "/reports/summary": controller.summary,
    "/reports/organizations/:id": controller.organization,
  };
}

export { createReportRoutes };
