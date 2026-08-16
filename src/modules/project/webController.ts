import { CORE_VIEW_TOKEN } from "@getstrata/bootstrap/providers/view";
import type { AppDependencies } from "@getstrata/core/contracts/di";
import { resolveService } from "@getstrata/core/contracts/di";
import { ValidationError } from "@getstrata/core/errors/http";
import { requestPrefersJson } from "@getstrata/core/http/contentNegotiation";
import { flashResponse } from "@getstrata/core/http/flashSession";
import { formDataToRecord, parseFormBody } from "@getstrata/core/http/parseFormBody";
import { withErrorHandling } from "@getstrata/core/http/response";
import { normalizeFieldErrors } from "@getstrata/core/http/webErrorResponse";
import type { ViewEngine } from "@getstrata/core/view";
import { htmlResponse, isHtmxRequest } from "@getstrata/core/view";
import { organizationServiceToken } from "../organization/provider";
import type OrganizationService from "../organization/service";
import { projectServiceToken } from "./provider";
import { parseProjectListQuery } from "./requests";
import type ProjectService from "./service";
import {
  parseWebCreateProjectBody,
  parseWebCreateProjectPayload,
  parseWebUpdateProjectBody,
  parseWebUpdateProjectPayload,
} from "./webRequests";

class ProjectWebController {
  constructor(private readonly dependencies: AppDependencies) {}

  private get organizations(): OrganizationService {
    return resolveService(this.dependencies, organizationServiceToken);
  }

  private get service(): ProjectService {
    return resolveService(this.dependencies, projectServiceToken);
  }

  private get view(): ViewEngine {
    return resolveService(this.dependencies, CORE_VIEW_TOKEN);
  }

  private async loadOrganizations() {
    const result = await this.organizations.paginate({ page: 1, perPage: 100 });

    return result.data;
  }

  private async renderIndex(
    request: Request | undefined,
    extras: Record<string, unknown> = {},
    status = 200,
  ): Promise<Response> {
    const query = parseProjectListQuery(request);
    const result = await this.service.paginate({
      page: query.page,
      perPage: query.perPage,
      organizationId: query.organizationId,
      status: query.status,
      includeOrganization: true,
    });
    const viewData = {
      title: "Projects",
      projects: result.data,
      meta: result.meta,
      page: query.page,
      perPage: query.perPage,
      organizations: await this.loadOrganizations(),
      errors: {},
      old: {},
      ...extras,
    };

    if (request && isHtmxRequest(request)) {
      return htmlResponse(await this.view.render("projects/_table", viewData, { layout: false }), {
        status,
      });
    }

    return htmlResponse(await this.view.render("projects/index", viewData), { status });
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
          ? parseWebCreateProjectPayload(old)
          : await parseWebCreateProjectBody(request);
      await this.service.create(body);

      return flashResponse(Response.redirect("/projects", 302), {
        level: "success",
        message: "Project created.",
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
    const project = await this.service.findByIdOrThrow(id, { includeOrganization: true });

    return htmlResponse(
      await this.view.render("projects/show", {
        title: project.name,
        project,
        errors: {},
        old: {},
      }),
    );
  });

  readonly update = withErrorHandling(async (request: Request & { params: { id: string } }) => {
    const id = Number.parseInt(String(request.params.id), 10);
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
          ? parseWebUpdateProjectPayload(old)
          : await parseWebUpdateProjectBody(request);
      const project = await this.service.update(id, body);

      if (isHtmxRequest(request)) {
        return htmlResponse(
          await this.view.render("projects/show", {
            title: project.name,
            project: await this.service.findByIdOrThrow(id, { includeOrganization: true }),
            errors: {},
            old: {},
          }),
        );
      }

      return flashResponse(Response.redirect(`/projects/${id}`, 302), {
        level: "success",
        message: "Project updated.",
      });
    } catch (error) {
      if (error instanceof ValidationError && request && !requestPrefersJson(request)) {
        const project = await this.service.findByIdOrThrow(id, { includeOrganization: true });

        return htmlResponse(
          await this.view.render("projects/show", {
            title: project.name,
            project,
            errors: normalizeFieldErrors(error.details),
            old,
          }),
          { status: 422 },
        );
      }

      throw error;
    }
  });

  readonly destroy = withErrorHandling(async (request: Request & { params: { id: string } }) => {
    const id = Number.parseInt(String(request.params.id), 10);
    await this.service.delete(id);

    return flashResponse(Response.redirect("/projects", 302), {
      level: "success",
      message: "Project deleted.",
    });
  });
}

export default ProjectWebController;
