import type { HttpKernel } from "@getstrata/bootstrap/httpKernel";
import { CORE_VIEW_TOKEN } from "@getstrata/bootstrap/providers/view";
import { currentAuthUser } from "@getstrata/core/auth/authContext";
import { CACHE_TAGS } from "@getstrata/core/cache/tags";
import type { AppDependencies } from "@getstrata/core/contracts/di";
import { resolveService } from "@getstrata/core/contracts/di";
import type { RouteHandler } from "@getstrata/core/http/middleware";
import { parseMultipartUpload } from "@getstrata/core/http/parseMultipartUpload";
import { withErrorHandling } from "@getstrata/core/http/response";
import type { RouteRequest } from "@getstrata/core/http/route";
import { hasValidSignature, temporarySignedUrl } from "@getstrata/core/http/signedUrl";
import {
  resolveApplicationAuth,
  resolveApplicationPolicyGate,
} from "@getstrata/core/runtime/applicationRegistry";
import type { ViewEngine } from "@getstrata/core/view";
import { htmlResponse, isHtmxRequest } from "@getstrata/core/view";
import { attachmentServiceToken } from "./provider";
import { parseAttachmentIdParams, parseTaskAttachmentParams } from "./requests";
import type AttachmentService from "./service";

class AttachmentWebController {
  constructor(private readonly dependencies: AppDependencies) {}

  private get service(): AttachmentService {
    return resolveService(this.dependencies, attachmentServiceToken);
  }

  private get view(): ViewEngine {
    return resolveService(this.dependencies, CORE_VIEW_TOKEN);
  }

  private async renderTaskAttachments(taskId: number, extras: Record<string, unknown> = {}) {
    const attachments = await this.service.listByTaskId(taskId);

    return this.view.render(
      "attachments/_list",
      {
        taskId,
        attachments: attachments.map((attachment) => ({
          ...attachment,
          downloadUrl: temporarySignedUrl(`/attachments/${attachment.id}/download`, 60 * 60),
        })),
        errors: {},
        ...extras,
      },
      { layout: false },
    );
  }

  readonly listForTask = withErrorHandling(async (req: RouteRequest<{ id: string }>) => {
    const { taskId } = parseTaskAttachmentParams(req.params);

    return htmlResponse(await this.renderTaskAttachments(taskId));
  });

  readonly storeForTask = withErrorHandling(async (req: RouteRequest<{ id: string }>) => {
    resolveApplicationPolicyGate().authorize("attachment", "create", currentAuthUser());
    const { taskId } = parseTaskAttachmentParams(req.params);
    const upload = await parseMultipartUpload(req);

    await this.service.create({ taskId, upload });
    await this.dependencies.cache.tags(CACHE_TAGS.attachments).flush();

    return htmlResponse(await this.renderTaskAttachments(taskId), { status: 201 });
  });

  readonly download = withErrorHandling(async (req: RouteRequest<{ id: string }>) => {
    const { attachmentId } = parseAttachmentIdParams(req.params);
    const attachment = await this.service.findByIdOrThrow(attachmentId);

    const signed = typeof req.url === "string" && hasValidSignature(req);

    if (!signed) {
      const user =
        (typeof req.url === "string" ? await resolveApplicationAuth().resolve(req) : null) ??
        currentAuthUser();
      resolveApplicationPolicyGate().authorize("attachment", "view", user, attachment);
    }

    const { contents } = await this.service.readContents(attachmentId);

    return new Response(contents, {
      headers: {
        "Content-Type": attachment.mime_type,
        "Content-Disposition": `attachment; filename="${attachment.original_name.replace(/"/g, "")}"`,
      },
    });
  });

  readonly destroy = withErrorHandling(async (req: RouteRequest<{ id: string }>) => {
    const { attachmentId } = parseAttachmentIdParams(req.params);
    const attachment = await this.service.findByIdOrThrow(attachmentId);
    resolveApplicationPolicyGate().authorize("attachment", "delete", currentAuthUser(), attachment);
    const taskId = attachment.task_id;

    await this.service.delete(attachmentId);
    await this.dependencies.cache.tags(CACHE_TAGS.attachments).flush();

    if (isHtmxRequest(req)) {
      return htmlResponse(await this.renderTaskAttachments(taskId));
    }

    return Response.redirect(`/tasks/${taskId}`, 302);
  });
}

function createAttachmentWebRoutes(dependencies: AppDependencies, kernel: HttpKernel) {
  const controller = new AttachmentWebController(dependencies);

  return {
    "/tasks/:id/attachments": {
      GET: kernel.wrapWebPublicRead(controller.listForTask as unknown as RouteHandler),
      POST: kernel.wrapWebAuthenticated(controller.storeForTask as unknown as RouteHandler),
    },
    "/attachments/:id/download": kernel.wrapWeb(controller.download as unknown as RouteHandler),
    "/attachments/:id": {
      DELETE: kernel.wrapWebAuthenticated(controller.destroy as unknown as RouteHandler),
    },
  };
}

export default AttachmentWebController;
export { createAttachmentWebRoutes };
