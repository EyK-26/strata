import type { HttpKernel } from "@getstrata/bootstrap/httpKernel";
import { CORE_VIEW_TOKEN } from "@getstrata/bootstrap/providers/view";
import { currentAuthUser } from "@getstrata/core/auth/authContext";
import type { AppDependencies } from "@getstrata/core/contracts/di";
import { resolveService } from "@getstrata/core/contracts/di";
import type { RouteHandler } from "@getstrata/core/http/middleware";
import { withErrorHandling } from "@getstrata/core/http/response";
import type { ViewEngine } from "@getstrata/core/view";
import { htmlResponse, isHtmxRequest } from "@getstrata/core/view";
import {
  parseHtmlOrganizationIdQuery,
  resolveHtmlProjectListOrganizationId,
} from "../project/listScope";
import {
  type CurrentOrganizationService,
  currentOrganizationServiceToken,
} from "../user/currentOrganizationService";
import { searchServiceToken } from "./provider";
import type SearchService from "./service";

class SearchWebController {
  constructor(private readonly dependencies: AppDependencies) {}

  private get currentOrganization(): CurrentOrganizationService {
    return resolveService(this.dependencies, currentOrganizationServiceToken);
  }

  private get service(): SearchService {
    return resolveService(this.dependencies, searchServiceToken);
  }

  private get view(): ViewEngine {
    return resolveService(this.dependencies, CORE_VIEW_TOKEN);
  }

  readonly index = withErrorHandling(async (request?: Request) => {
    const query =
      new URL(request?.url ?? "http://local/search").searchParams.get("q")?.trim() ?? "";
    const organizationId = await resolveHtmlProjectListOrganizationId({
      queryOrganizationId: parseHtmlOrganizationIdQuery(request),
      user: currentAuthUser(),
      currentForUser: (userId) => this.currentOrganization.currentForUser(userId),
    });
    const results = query ? await this.service.search(query, { organizationId }) : [];
    const viewData = {
      title: "Search",
      query,
      results,
      currentOrganizationId: organizationId,
    };

    if (request && isHtmxRequest(request)) {
      return htmlResponse(await this.view.render("search/_results", viewData, { layout: false }));
    }

    return htmlResponse(await this.view.render("search/index", viewData));
  });
}

function createSearchWebRoutes(dependencies: AppDependencies, kernel: HttpKernel) {
  const controller = new SearchWebController(dependencies);

  return {
    "/search": {
      GET: kernel.wrapWebAuthenticated(controller.index as unknown as RouteHandler),
    },
  };
}

export default SearchWebController;
export { createSearchWebRoutes };
