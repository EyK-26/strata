import type { HttpKernel } from "@getstrata/bootstrap/httpKernel";
import { CORE_VIEW_TOKEN } from "@getstrata/bootstrap/providers/view";
import type { AppDependencies } from "@getstrata/core/contracts/di";
import { resolveService } from "@getstrata/core/contracts/di";
import type { RouteHandler } from "@getstrata/core/http/middleware";
import { withErrorHandling } from "@getstrata/core/http/response";
import type { ViewEngine } from "@getstrata/core/view";
import { htmlResponse } from "@getstrata/core/view";
import { reportServiceToken } from "./provider";
import { parseOrganizationReportParams } from "./requests";
import type ReportService from "./service";

class ReportWebController {
  constructor(private readonly dependencies: AppDependencies) {}

  private get service(): ReportService {
    return resolveService(this.dependencies, reportServiceToken);
  }

  private get view(): ViewEngine {
    return resolveService(this.dependencies, CORE_VIEW_TOKEN);
  }

  readonly summary = withErrorHandling(async () => {
    const summary = await this.service.getSummary();

    return htmlResponse(
      await this.view.render("reports/summary", {
        title: "Reports",
        summary,
      }),
    );
  });

  readonly organization = withErrorHandling(async (req: { params: { id: string } }) => {
    const { id } = parseOrganizationReportParams(req.params);
    const report = await this.service.getOrganizationReport(id);

    return htmlResponse(
      await this.view.render("reports/organization", {
        title: `${report.organization.name} report`,
        report,
      }),
    );
  });
}

function createReportWebRoutes(dependencies: AppDependencies, kernel: HttpKernel) {
  const controller = new ReportWebController(dependencies);

  return {
    "/reports": {
      GET: kernel.wrapWebAuthenticated(controller.summary as unknown as RouteHandler),
    },
    "/reports/organizations/:id": {
      GET: kernel.wrapWebAuthenticated(controller.organization as unknown as RouteHandler),
    },
  };
}

export default ReportWebController;
export { createReportWebRoutes };
