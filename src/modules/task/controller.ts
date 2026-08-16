import { CACHE_TAGS } from "@getstrata/core/cache/tags";
import type { AppDependencies, CachedJson } from "@getstrata/core/contracts/di";
import { resolveService } from "@getstrata/core/contracts/di";
import {
  createdResponse,
  jsonResponse,
  noContentResponse,
  withErrorHandling,
} from "@getstrata/core/http";
import type { RouteRequest } from "@getstrata/core/http/route";
import { securedBindRouteModel } from "@getstrata/core/http/securedRouteModelBinding";
import { buildRequestCacheKey } from "@getstrata/core/http/validation";
import { taskServiceToken } from "./provider";
import {
  parseCreateTaskBody,
  parseTaskListQuery,
  parseUpdateTaskBody,
  type TaskIdParams,
} from "./requests";
import { toTaskPaginatedResourceCollection, toTaskResource } from "./resources";
import type TaskService from "./service";

class TaskController {
  constructor(
    private readonly dependencies: AppDependencies,
    private readonly cachedJson: CachedJson,
  ) {}

  private get service(): TaskService {
    return resolveService(this.dependencies, taskServiceToken);
  }

  readonly index = withErrorHandling(async (request?: Request) => {
    const query = parseTaskListQuery(request);
    const cacheKey = buildRequestCacheKey("/tasks", request);

    return await this.cachedJson(
      cacheKey,
      async () => {
        const result = await this.service.paginate({
          page: query.page,
          perPage: query.perPage,
          projectId: query.projectId,
          status: query.status,
          includeProject: query.include === "project",
        });
        return toTaskPaginatedResourceCollection(result.data, result.meta);
      },
      [CACHE_TAGS.tasks],
      request,
    );
  });

  readonly show = withErrorHandling(
    securedBindRouteModel(
      "id",
      (id) =>
        this.service.findByIdOrThrow(id, {
          includeProject: true,
        }),
      { resource: "task", action: "view" },
      async (_request, task) => {
        return jsonResponse(toTaskResource(task));
      },
    ),
  );

  readonly store = withErrorHandling(async (request: Request) => {
    const body = await parseCreateTaskBody(request);
    const task = await this.service.create(body);
    return createdResponse(toTaskResource(task));
  });

  readonly update = withErrorHandling(
    securedBindRouteModel(
      "id",
      (id) => this.service.findByIdOrThrow(id),
      { resource: "task", action: "update" },
      async (req: RouteRequest<TaskIdParams>, task) => {
        const body = await parseUpdateTaskBody(req);
        const updated = await this.service.update(task.id, body);
        return jsonResponse(toTaskResource(updated));
      },
    ),
  );

  readonly destroy = withErrorHandling(
    securedBindRouteModel(
      "id",
      (id) => this.service.findByIdOrThrow(id),
      { resource: "task", action: "delete" },
      async (_request, task) => {
        await this.service.delete(task.id);
        return noContentResponse();
      },
    ),
  );
}

export default TaskController;
