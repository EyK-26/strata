import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { ForbiddenError } from "@getstrata/core/errors/http";
import { applyConditionalGet, etagFromResource, isEtagEnabled } from "@getstrata/core/http/etag";
import { createMemoryThrottleMiddleware } from "@getstrata/core/http/memoryThrottleMiddleware";
import { parsePaginationQuery } from "@getstrata/core/http/pagination";
import { parseMultipartUpload } from "@getstrata/core/http/parseMultipartUpload";
import { withMiddleware } from "@getstrata/core/http/routeMiddleware";
import { assertValidSignature, temporarySignedUrl } from "@getstrata/core/http/signedUrl";
import { bindModel } from "../../http/bind.ts";
import { authorize, requireCurrentUser } from "../../http/currentUser.ts";
import { ApplicationResource } from "../../http/resources.ts";
import { wrapApi } from "../../http/wrap.ts";
import { loadApplicationDetail } from "../../lib/loaders.ts";
import { Application } from "../../models/Application.ts";
import { interviewNotification, notifyUser } from "../notifications/service.ts";
import { users } from "../users/repository.ts";
import { reportingService } from "./reporting.ts";
import {
  ApplicationIndexRequest,
  CreateApplicationRequest,
  InterviewNotifyRequest,
  TransferApplicationRequest,
} from "./requests.ts";
import { applicationService } from "./service.ts";

const applyThrottle = createMemoryThrottleMiddleware({
  maxAttempts: 8,
  decaySeconds: 60,
  keyPrefix: "hiroapp-apply:",
});

export function applicationRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/api/applications": {
      GET: wrapApi(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        const query = new ApplicationIndexRequest().validate(request);
        const pagination = parsePaginationQuery(request);
        const page = await applicationService.listForActor(user, query, pagination);
        const payload = page.map((application) => new ApplicationResource(application).toArray());
        return jsonResponse({
          data: payload,
          meta: { page: pagination.page, per_page: pagination.perPage },
        });
      }),
      POST: withMiddleware(applyThrottle)(
        wrapApi(dependencies, async (request) => {
          const user = await authorize(request, "applications", "create");
          const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
          if (contentType.includes("multipart/form-data")) {
            const upload = await parseMultipartUpload(request.clone(), "resume");
            const form = await request.formData();
            const positionId = Number(form.get("position_id"));
            const storedPath = dependencies.storage
              ? await dependencies.storage.put(
                  `resumes/${user.id}-${positionId}-${upload.fileName}`,
                  upload.contents,
                )
              : upload.fileName;
            const created = await applicationService.apply(user, {
              position_id: positionId,
              attachment_text: null,
              attachment_file: storedPath,
              source_id: form.get("source_id") ? Number(form.get("source_id")) : null,
            });
            return jsonResponse(new ApplicationResource(created).toResponse());
          }
          const payload = await new CreateApplicationRequest().validate(request);
          let storedPath = payload.attachment_file;
          if (payload.attachment_text && dependencies.storage) {
            storedPath = await dependencies.storage.put(
              `resumes/${user.id}-${payload.position_id}.txt`,
              payload.attachment_text,
            );
          }
          const created = await applicationService.apply(user, {
            ...payload,
            attachment_file: storedPath,
          });
          return jsonResponse(new ApplicationResource(created).toResponse());
        }),
      ),
    },
    "/api/pipeline/summary": {
      GET: wrapApi(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        const query = new ApplicationIndexRequest().validate(request);
        return jsonResponse(await applicationService.summaryForActor(user, query.department_id));
      }),
    },
    "/api/applications/:id": {
      GET: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Application.findOrFail(id),
          async (request, application) => {
            await authorize(request, "applications", "view", application);
            const payload = await loadApplicationDetail(Number(application.id));
            const response = jsonResponse(payload);
            if (isEtagEnabled()) {
              return applyConditionalGet(
                request,
                response,
                etagFromResource(application.toObject()),
              );
            }
            return response;
          },
        ),
      ),
    },
    "/api/applications/:id/withdraw": {
      POST: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Application.findOrFail(id),
          async (request, application) => {
            await authorize(request, "applications", "delete", application);
            await application.delete();
            return jsonResponse({ withdrawn: true });
          },
        ),
      ),
    },
    "/api/applications/:id/restore": {
      POST: wrapApi(
        dependencies,
        bindModel(
          "id",
          async (id) => {
            const application = await Application.onlyTrashed().where({ id }).first();
            if (!application) {
              throw new ForbiddenError("No withdrawn application to restore.");
            }
            return application;
          },
          async (request, application) => {
            await authorize(request, "applications", "update");
            await application.restore();
            return jsonResponse({ restored: true });
          },
        ),
      ),
    },
    "/api/applications/:id/end": {
      POST: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Application.findOrFail(id),
          async (request, application) => {
            const actor = await requireCurrentUser(request);
            await authorize(request, "applications", "delete", application);
            await applicationService.end(actor, application);
            return jsonResponse(null);
          },
        ),
      ),
    },
    "/api/applications/:id/move": {
      POST: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Application.findOrFail(id),
          async (request, application) => {
            const actor = await authorize(request, "applications", "update");
            await applicationService.move(actor, application);
            return jsonResponse(null);
          },
        ),
      ),
    },
    "/api/applications/:id/transfer": {
      POST: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Application.findOrFail(id),
          async (request, application) => {
            const actor = await authorize(request, "applications", "update");
            const payload = await new TransferApplicationRequest().validate(request);
            const updated = await applicationService.transfer(actor, application, payload);
            return jsonResponse(new ApplicationResource(updated).toArray());
          },
        ),
      ),
    },
    "/api/applications/notify": {
      POST: wrapApi(dependencies, async (request) => {
        const actor = await authorize(request, "applications", "update");
        const payload = await new InterviewNotifyRequest().validate(request);
        const applicant = await users.findByIdOrThrow(payload.applicant_id);
        const confirmPath = temporarySignedUrl("/api/interviews/confirm", 60 * 60 * 24, {
          applicant_id: applicant.id,
        });
        const message = interviewNotification({
          text: `${payload.text}\nConfirm: ${confirmPath}`,
          datetime: payload.datetime,
          place: payload.place,
          sender: payload.sender.first_name
            ? payload.sender
            : { first_name: actor.first_name, last_name: actor.last_name, email: actor.email },
          to: applicant.email,
        });
        await notifyUser({ userId: applicant.id, ...message });
        return jsonResponse({ confirm_url: confirmPath });
      }),
    },
    "/api/interviews/confirm": {
      GET: wrapApi(dependencies, async (request) => {
        assertValidSignature(request);
        const applicantId = Number(new URL(request.url).searchParams.get("applicant_id"));
        const user = await requireCurrentUser(request);
        if (Number(user.id) !== applicantId) {
          throw new ForbiddenError("Signed interview confirm is for another user.");
        }
        return jsonResponse({ confirmed: true, applicant_id: applicantId });
      }),
    },
    "/api/export/applications": {
      GET: wrapApi(dependencies, async (request) => {
        const actor = await authorize(request, "applications", "update");
        return jsonResponse(await reportingService.exportAll(actor));
      }),
    },
  };
}
