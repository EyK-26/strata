import type { AppDependencies, CachedJson } from "@getstrata/bootstrap/contracts";
import { resolveService } from "@getstrata/bootstrap/contracts";
import { CACHE_TAGS } from "@getstrata/core/cache/tags";
import {
  buildRequestCacheKey,
  createdResponse,
  jsonResponse,
  noContentResponse,
  type RouteRequest,
  securedBindRouteModel,
  withErrorHandling,
} from "@getstrata/core/http";
import { commentServiceToken } from "./provider";
import {
  type CommentIdParams,
  parseCommentListQuery,
  parseCreateCommentBody,
  parseTaskCommentParams,
  parseUpdateCommentBody,
  type TaskCommentParams,
} from "./requests";
import { toCommentPaginatedResourceCollection, toCommentResource } from "./resources";
import type CommentService from "./service";

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
      request,
    );
  });

  readonly show = withErrorHandling(
    securedBindRouteModel(
      "id",
      (id) => this.service.findByIdOrThrow(id),
      { resource: "comment", action: "view" },
      async (_request, comment) => {
        return jsonResponse(toCommentResource(comment));
      },
    ),
  );

  readonly byTask = withErrorHandling(async (req: RouteRequest<TaskCommentParams>) => {
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
      req,
    );
  });

  readonly storeForTask = withErrorHandling(async (req: RouteRequest<TaskCommentParams>) => {
    const { taskId } = parseTaskCommentParams(req.params);
    const body = await parseCreateCommentBody(req);
    const comment = await this.service.create({
      task_id: taskId,
      body: body.body,
    });
    return createdResponse(toCommentResource(comment));
  });

  readonly update = withErrorHandling(
    securedBindRouteModel(
      "id",
      (id) => this.service.findByIdOrThrow(id),
      { resource: "comment", action: "update" },
      async (req: RouteRequest<CommentIdParams>, comment) => {
        const body = await parseUpdateCommentBody(req);
        const updated = await this.service.update(comment.id, body);
        return jsonResponse(toCommentResource(updated));
      },
    ),
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
