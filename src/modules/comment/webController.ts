import type { AppDependencies } from "@getstrata/bootstrap/contracts";
import { resolveService } from "@getstrata/bootstrap/contracts";
import type { HttpKernel } from "@getstrata/bootstrap/httpKernel";
import { CORE_VIEW_TOKEN } from "@getstrata/bootstrap/providers/view";
import { ValidationError } from "@getstrata/core/errors/http";
import { withErrorHandling } from "@getstrata/core/http";
import { requestPrefersJson } from "@getstrata/core/http/contentNegotiation";
import { resolveCsrfTokenForRequest } from "@getstrata/core/http/csrfToken";
import type { RouteHandler } from "@getstrata/core/http/middleware";
import { formDataToRecord, parseFormBody } from "@getstrata/core/http/parseFormBody";
import { normalizeFieldErrors } from "@getstrata/core/http/webErrorResponse";
import type { ViewEngine } from "@getstrata/core/view";
import { htmlResponse } from "@getstrata/core/view";
import { commentServiceToken } from "./provider";
import { parseCommentIdParams, parseTaskCommentParams } from "./requests";
import type CommentService from "./service";
import {
  parseWebCreateCommentBody,
  parseWebCreateCommentPayload,
  parseWebUpdateCommentBody,
  parseWebUpdateCommentPayload,
} from "./webRequests";

class CommentWebController {
  constructor(private readonly dependencies: AppDependencies) {}

  private get service(): CommentService {
    return resolveService(this.dependencies, commentServiceToken);
  }

  private get view(): ViewEngine {
    return resolveService(this.dependencies, CORE_VIEW_TOKEN);
  }

  private async renderTaskComments(
    taskId: number,
    request?: Request,
    extras: Record<string, unknown> = {},
    status = 200,
  ): Promise<Response> {
    const comments = await this.service.paginateByTaskId(taskId, { page: 1, perPage: 100 });
    const csrfToken = request ? resolveCsrfTokenForRequest(request) : "";

    return htmlResponse(
      await this.view.render(
        "comments/_list",
        {
          taskId,
          comments: comments.data,
          csrfToken,
          errors: {},
          old: {},
          ...extras,
        },
        { layout: false },
      ),
      { status },
    );
  }

  readonly storeForTask = withErrorHandling(
    async (request: Request & { params: { id: string } }) => {
      const { taskId } = parseTaskCommentParams(request.params);
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
            ? parseWebCreateCommentPayload(old)
            : await parseWebCreateCommentBody(request);
        await this.service.create({ task_id: taskId, body: body.body });

        return await this.renderTaskComments(taskId, request, {}, 201);
      } catch (error) {
        if (error instanceof ValidationError && request && !requestPrefersJson(request)) {
          return await this.renderTaskComments(
            taskId,
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
    },
  );

  readonly update = withErrorHandling(async (request: Request & { params: { id: string } }) => {
    const { id } = parseCommentIdParams(request.params);
    const comment = await this.service.findByIdOrThrow(id);
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
          ? parseWebUpdateCommentPayload(old)
          : await parseWebUpdateCommentBody(request);
      await this.service.update(id, body);

      return await this.renderTaskComments(comment.task_id, request);
    } catch (error) {
      if (error instanceof ValidationError && request && !requestPrefersJson(request)) {
        return await this.renderTaskComments(
          comment.task_id,
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

  readonly destroy = withErrorHandling(async (request: Request & { params: { id: string } }) => {
    const { id } = parseCommentIdParams(request.params);
    const comment = await this.service.findByIdOrThrow(id);
    await this.service.delete(id);

    return await this.renderTaskComments(comment.task_id, request);
  });
}

function createCommentWebRoutes(dependencies: AppDependencies, kernel: HttpKernel) {
  const controller = new CommentWebController(dependencies);

  return {
    "/tasks/:id/comments": {
      POST: kernel.wrapWebAbility(
        "comments:create",
        controller.storeForTask as unknown as RouteHandler,
      ),
    },
    "/comments/:id": {
      PATCH: kernel.wrapWebAbility("comments:update", controller.update as unknown as RouteHandler),
      DELETE: kernel.wrapWebAbility(
        "comments:delete",
        controller.destroy as unknown as RouteHandler,
      ),
    },
  };
}

export default CommentWebController;
export { createCommentWebRoutes };
