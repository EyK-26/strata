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
import CommentService from "./service";
import { commentServiceToken } from "./provider";
import {
  parseCommentListQuery,
  parseCreateCommentBody,
  parseTaskCommentParams,
  type TaskCommentParams,
} from "./requests";
import {
  toCommentPaginatedResourceCollection,
  toCommentResource,
} from "./resources";

class CommentController {
  constructor(
    private readonly dependencies: AppDependencies,
    private readonly cachedJson: CachedJson,
  ) {}

  private get service(): CommentService {
    return resolveService(this.dependencies, commentServiceToken);
  }

  readonly index = withErrorHandling(async (request?: Request) => {
    const query = parseCommentListQuery(request);
    const cacheKey = buildRequestCacheKey("/comments", request);

    return await this.cachedJson(
      cacheKey,
      async () => {
        const result = await this.service.paginate(query);
        return toCommentPaginatedResourceCollection(result.data, result.meta);
      },
      [CACHE_TAGS.comments],
    );
  });

  readonly show = withErrorHandling(
    bindRouteModel(
      "id",
      (id) => this.service.findByIdOrThrow(id),
      async (_request, comment) => {
        return jsonResponse(toCommentResource(comment));
      },
    ),
  );

  readonly byTask = withErrorHandling(
    async (req: RouteRequest<TaskCommentParams>) => {
      const { taskId } = parseTaskCommentParams(req.params);
      const query = parseCommentListQuery(req);
      const cacheKey = buildRequestCacheKey(`/tasks/${taskId}/comments`, req);

      return await this.cachedJson(
        cacheKey,
        async () => {
          const result = await this.service.paginateByTaskId(taskId, query);
          return toCommentPaginatedResourceCollection(result.data, result.meta);
        },
        [CACHE_TAGS.comments],
      );
    },
  );

  readonly storeForTask = withErrorHandling(
    async (req: RouteRequest<TaskCommentParams>) => {
      const { taskId } = parseTaskCommentParams(req.params);
      const body = await parseCreateCommentBody(req);
      const comment = await this.service.create({
        task_id: taskId,
        body: body.body,
      });
      return createdResponse(toCommentResource(comment));
    },
  );

  readonly destroy = withErrorHandling(
    securedBindRouteModel(
      "id",
      (id) => this.service.findByIdOrThrow(id),
      { resource: "comment", action: "delete" },
      async (_request, comment) => {
        await this.service.delete(comment.id);
        return noContentResponse();
      },
    ),
  );
}

export default CommentController;
