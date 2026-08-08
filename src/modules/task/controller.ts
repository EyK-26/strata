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
import TaskService from "./service";
import { taskServiceToken } from "./provider";
import {
  parseCreateTaskBody,
  parseTaskListQuery,
  parseUpdateTaskBody,
  type TaskIdParams,
} from "./requests";
import { toTaskPaginatedResourceCollection, toTaskResource } from "./resources";

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
    );
  });

  readonly show = withErrorHandling(
    bindRouteModel(
      "id",
      (id, request) => {
        const query = parseTaskListQuery(request);
        return this.service.findByIdOrThrow(id, {
          includeProject: query.include === "project",
        });
      },
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
