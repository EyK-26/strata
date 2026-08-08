import type { AppDependencies, CachedJson } from "../../bootstrap/contracts";
import { resolveService } from "../../bootstrap/contracts";
import { CACHE_TAGS } from "../../core/cache/tags";
import {
  bindRouteModel,
  buildRequestCacheKey,
  createdResponse,
  jsonResponse,
  noContentResponse,
  securedBindRouteModel,
  type RouteRequest,
  withErrorHandling,
} from "../../core/http";
import ProjectService from "./service";
import { projectServiceToken } from "./provider";
import {
  parseCreateProjectBody,
  parseProjectListQuery,
  parseUpdateProjectBody,
  type ProjectIdParams,
} from "./requests";
import { toProjectPaginatedResourceCollection, toProjectResource } from "./resources";

class ProjectController {
  constructor(
    private readonly dependencies: AppDependencies,
    private readonly cachedJson: CachedJson,
  ) {}

  private get service(): ProjectService {
    return resolveService(this.dependencies, projectServiceToken);
  }

  readonly index = withErrorHandling(async (request?: Request) => {
    const query = parseProjectListQuery(request);
    const cacheKey = buildRequestCacheKey("/projects", request);

    return await this.cachedJson(
      cacheKey,
      async () => {
        const result = await this.service.paginate({
          page: query.page,
          perPage: query.perPage,
          organizationId: query.organizationId,
          status: query.status,
          includeOrganization: query.include === "organization",
        });
        return toProjectPaginatedResourceCollection(result.data, result.meta);
      },
      [CACHE_TAGS.projects],
    );
  });

  readonly show = withErrorHandling(
    bindRouteModel(
      "id",
      (id, request) => {
        const query = parseProjectListQuery(request);
        return this.service.findByIdOrThrow(id, {
          includeOrganization: query.include === "organization",
        });
      },
      async (_request, project) => {
        return jsonResponse(toProjectResource(project));
      },
    ),
  );

  readonly store = withErrorHandling(async (request: Request) => {
    const body = await parseCreateProjectBody(request);
    const project = await this.service.create(body);
    return createdResponse(toProjectResource(project));
  });

  readonly update = withErrorHandling(
    securedBindRouteModel(
      "id",
      (id) => this.service.findByIdOrThrow(id),
      { resource: "project", action: "update" },
      async (req: RouteRequest<ProjectIdParams>, project) => {
        const body = await parseUpdateProjectBody(req);
        const updated = await this.service.update(project.id, body);
        return jsonResponse(toProjectResource(updated));
      },
    ),
  );

  readonly destroy = withErrorHandling(
    securedBindRouteModel(
      "id",
      (id) => this.service.findByIdOrThrow(id),
      { resource: "project", action: "delete" },
      async (_request, project) => {
        await this.service.delete(project.id);
        return noContentResponse();
      },
    ),
  );
}

export default ProjectController;
