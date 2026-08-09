import type { AppDependencies } from "@getstrata/bootstrap/contracts";
import { resolveService } from "@getstrata/bootstrap/contracts";
import { CORE_VIEW_TOKEN } from "@getstrata/bootstrap/providers/view";
import { ValidationError } from "@getstrata/core/errors/http";
import { withErrorHandling } from "@getstrata/core/http";
import { requestPrefersJson } from "@getstrata/core/http/contentNegotiation";
import { flashResponse } from "@getstrata/core/http/flashSession";
import { formDataToRecord, parseFormBody } from "@getstrata/core/http/parseFormBody";
import { normalizeFieldErrors } from "@getstrata/core/http/webErrorResponse";
import type { ViewEngine } from "@getstrata/core/view";
import { htmlResponse, isHtmxRequest } from "@getstrata/core/view";
import { organizationServiceToken } from "./provider";
import { parseOrganizationListQuery } from "./requests";
import type OrganizationService from "./service";
import { parseWebCreateOrganizationBody, parseWebCreateOrganizationPayload } from "./webRequests";

class OrganizationWebController {
  constructor(private readonly dependencies: AppDependencies) {}

  private get service(): OrganizationService {
    return resolveService(this.dependencies, organizationServiceToken);
  }

  private get view(): ViewEngine {
    return resolveService(this.dependencies, CORE_VIEW_TOKEN);
  }

  private async renderIndex(
    request: Request | undefined,
    extras: Record<string, unknown> = {},
    status = 200,
  ): Promise<Response> {
    const query = parseOrganizationListQuery(request);
    const result = await this.service.paginate(query);
    const viewData = {
      title: "Organizations",
      organizations: result.data,
      meta: result.meta,
      page: query.page,
      perPage: query.perPage,
      errors: {},
      old: {},
      ...extras,
    };

    if (request && isHtmxRequest(request)) {
      return htmlResponse(
        await this.view.render("organizations/_table", viewData, { layout: false }),
        { status },
      );
    }

    return htmlResponse(await this.view.render("organizations/index", viewData), { status });
  }

  readonly index = withErrorHandling(async (request?: Request) => {
    return await this.renderIndex(request);
  });

  readonly store = withErrorHandling(async (request: Request) => {
    const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
    const old =
      contentType.includes("application/x-www-form-urlencoded") ||
      contentType.includes("multipart/form-data")
        ? formDataToRecord(await request.formData())
        : await parseFormBody(request).catch(() => ({}));

    try {
      const body =
        contentType.includes("application/x-www-form-urlencoded") ||
        contentType.includes("multipart/form-data")
          ? parseWebCreateOrganizationPayload(old)
          : await parseWebCreateOrganizationBody(request);
      await this.service.create(body);

      return flashResponse(Response.redirect("/organizations", 302), {
        level: "success",
        message: "Organization created.",
      });
    } catch (error) {
      if (error instanceof ValidationError && request && !requestPrefersJson(request)) {
        return await this.renderIndex(
          request,
          {
            errors: normalizeFieldErrors(error.details),
            old,
          },
          422,
        );
      }

      throw error;
    }
  });

  readonly show = withErrorHandling(async (request: Request & { params: { id: string } }) => {
    const id = Number.parseInt(String(request.params.id), 10);
    const organization = await this.service.findByIdOrThrow(id);

    return htmlResponse(
      await this.view.render("organizations/show", {
        title: organization.name,
        organization,
      }),
    );
  });
}

export default OrganizationWebController;
