import type { AppDependencies, CachedJson } from "@getstrata/bootstrap/contracts";
import { resolveService } from "@getstrata/bootstrap/contracts";
import type { HttpKernel } from "@getstrata/bootstrap/httpKernel";
import { CACHE_TAGS } from "@getstrata/core/cache/tags";
import {
  buildRequestCacheKey,
  createdResponse,
  jsonResponse,
  noContentResponse,
  parseMultipartUpload,
  type RouteRequest,
  securedBindRouteModel,
  withErrorHandling,
} from "@getstrata/core/http";
import type { RouteHandler } from "@getstrata/core/http/middleware";
import { attachmentServiceToken } from "./provider";
import { parseTaskAttachmentParams } from "./requests";
import { toAttachmentPaginatedResourceCollection, toAttachmentResource } from "./resources";
import type AttachmentService from "./service";

class AttachmentController {
  constructor(
    private readonly dependencies: AppDependencies,
    private readonly cachedJson: CachedJson,
  ) {}

  private get service(): AttachmentService {
    return resolveService(this.dependencies, attachmentServiceToken);
  }

  private async flushAttachmentCache(): Promise<void> {
    await this.dependencies.cache.tags(CACHE_TAGS.attachments).flush();
  }

  readonly byTask = withErrorHandling(async (req: RouteRequest<{ id: string }>) => {
    const { taskId } = parseTaskAttachmentParams(req.params);
    const cacheKey = buildRequestCacheKey(`/tasks/${taskId}/attachments`, req);

    return await this.cachedJson(
      cacheKey,
      async () => {
        const result = await this.service.paginateByTaskId(taskId, { page: 1, perPage: 100 });
        return toAttachmentPaginatedResourceCollection(result.data, result.meta);
      },
      [CACHE_TAGS.attachments],
      req,
    );
  });

  readonly storeForTask = withErrorHandling(async (req: RouteRequest<{ id: string }>) => {
    const { taskId } = parseTaskAttachmentParams(req.params);
    const upload = await parseMultipartUpload(req);
    const attachment = await this.service.create({ taskId, upload });
    await this.flushAttachmentCache();
    return createdResponse(toAttachmentResource(attachment));
  });

  readonly show = withErrorHandling(
    securedBindRouteModel(
      "id",
      (id) => this.service.findByIdOrThrow(id),
      { resource: "attachment", action: "view" },
      async (_request, attachment) => {
        return jsonResponse(toAttachmentResource(attachment));
      },
    ),
  );

  readonly download = withErrorHandling(
    securedBindRouteModel(
      "id",
      (id) => this.service.findByIdOrThrow(id),
      { resource: "attachment", action: "view" },
      async (_request, attachment) => {
        const { contents } = await this.service.readContents(attachment.id);

        return new Response(contents, {
          headers: {
            "Content-Type": attachment.mime_type,
            "Content-Disposition": `attachment; filename="${attachment.original_name.replace(/"/g, "")}"`,
          },
        });
      },
    ),
  );

  readonly destroy = withErrorHandling(
    securedBindRouteModel(
      "id",
      (id) => this.service.findByIdOrThrow(id),
      { resource: "attachment", action: "delete", requireIfMatch: false },
      async (_request, attachment) => {
        await this.service.delete(attachment.id);
        await this.flushAttachmentCache();
        return noContentResponse();
      },
    ),
  );
}

function createAttachmentRoutes(
  dependencies: AppDependencies,
  cachedJson: CachedJson,
  kernel: HttpKernel,
) {
  const controller = new AttachmentController(dependencies, cachedJson);

  return {
    "/attachments/:id": {
      GET: kernel.wrapPublicRead(controller.show as unknown as RouteHandler),
      DELETE: kernel.wrapAbility(
        "attachments:delete",
        controller.destroy as unknown as RouteHandler,
      ),
    },
    "/attachments/:id/download": kernel.wrapPublicRead(
      controller.download as unknown as RouteHandler,
    ),
    "/tasks/:id/attachments": {
      GET: kernel.wrapPublicRead(controller.byTask as unknown as RouteHandler),
      POST: kernel.wrapAbility(
        "attachments:create",
        controller.storeForTask as unknown as RouteHandler,
      ),
    },
  };
}

export default AttachmentController;
export { createAttachmentRoutes };
