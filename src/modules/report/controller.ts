import type { AppDependencies, CachedJson } from "../../bootstrap/contracts";
import { resolveService } from "../../bootstrap/contracts";
import { CACHE_TAGS } from "../../core/cache/tags";
import { buildRequestCacheKey, jsonResponse, withErrorHandling } from "../../core/http";
import { reportServiceToken } from "./provider";
import { parseOrganizationReportParams } from "./requests";
import { toOrganizationReportResource, toReportSummaryResource } from "./resources";
import type ReportService from "./service";

class ReportController {
  constructor(
    private readonly dependencies: AppDependencies,
    private readonly cachedJson: CachedJson,
  ) {}

  private get service(): ReportService {
    return resolveService(this.dependencies, reportServiceToken);
  }

  readonly summary = withErrorHandling(async (request?: Request) => {
    return await this.cachedJson(buildRequestCacheKey("/reports/summary", request), async () => {
      return toReportSummaryResource(await this.service.getSummary());
    }, [CACHE_TAGS.reports]);
  });

  readonly organization = withErrorHandling(async ({ params }: { params: { id: string } }) => {
    const { id } = parseOrganizationReportParams(params);
    const report = await this.service.getOrganizationReport(id);
    return jsonResponse(toOrganizationReportResource(report));
  });
}

export default ReportController;
