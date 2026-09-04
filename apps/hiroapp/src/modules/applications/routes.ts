import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { runInTransaction } from "@getstrata/core/database/transaction";
import {
  ConflictError,
  ForbiddenError,
  UnprocessableEntityError,
} from "@getstrata/core/errors/http";
import { applyConditionalGet, etagFromResource, isEtagEnabled } from "@getstrata/core/http/etag";
import { createMemoryThrottleMiddleware } from "@getstrata/core/http/memoryThrottleMiddleware";
import { parsePaginationQuery } from "@getstrata/core/http/pagination";
import { jsonResponse } from "@getstrata/core/http/response";
import { withMiddleware } from "@getstrata/core/http/routeMiddleware";
import { assertValidSignature, temporarySignedUrl } from "@getstrata/core/http/signedUrl";
import { bindModel } from "../../http/bind.ts";
import { authorize, requireCurrentUser } from "../../http/currentUser.ts";
import { ApplicationResource } from "../../http/resources.ts";
import { wrapApi } from "../../http/wrap.ts";
import { loadApplicationDetail } from "../../lib/loaders.ts";
import { isCandidate, STATUS } from "../../lib/roles.ts";
import { Application } from "../../models/Application.ts";
import { Position } from "../../models/Position.ts";
import { User } from "../../models/User.ts";
import {
  endedNotification,
  hiredNotification,
  interviewNotification,
  notifyUser,
} from "../notifications/service.ts";
import { positions } from "../positions/repository.ts";
import { users } from "../users/repository.ts";
import { applications } from "./repository.ts";
import {
  ApplicationIndexRequest,
  CreateApplicationRequest,
  InterviewNotifyRequest,
} from "./requests.ts";

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
        const search = query.search.trim();
        let builder = Application.where({ user_id: user.id });
        if (search) {
          builder = builder.whereHas("position", (related) => {
            related.where?.({ name: { ilike: `%${search}%` } });
          });
        }
        const page = await builder
          .limit(pagination.perPage)
          .offset((pagination.page - 1) * pagination.perPage)
          .get();
        await Promise.all(page.map((application) => application.load("position", "status")));
        const payload = page.map((application) => new ApplicationResource(application).toArray());
        return jsonResponse({
          data: payload,
          meta: { page: pagination.page, per_page: pagination.perPage },
        });
      }),
      POST: withMiddleware(
        applyThrottle,
        wrapApi(dependencies, async (request) => {
          const user = await authorize(request, "applications", "create");
          const payload = await new CreateApplicationRequest().validate(request);
          const existing = await applications.findPair(user.id, payload.position_id);
          if (existing) {
            throw new ConflictError("You have already applied to this position.");
          }
          let storedPath = payload.attachment_file;
          if (payload.attachment_text && dependencies.storage) {
            storedPath = await dependencies.storage.put(
              `resumes/${user.id}-${payload.position_id}.txt`,
              payload.attachment_text,
            );
          }
          const created = await User.newFromRecord(user).applications().create({
            position_id: payload.position_id,
            status_id: STATUS.APPLIED,
            attachment_text: payload.attachment_text,
            attachment_file: storedPath,
          });
          return jsonResponse(new ApplicationResource(created).toResponse());
        }),
      ),
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
            if (Number(application.get("status_id")) === STATUS.ENDED) {
              throw new ForbiddenError("Application is already ended.");
            }
            await applications.updateById(Number(application.id), { status_id: STATUS.ENDED });
            if (!isCandidate(actor.role_id)) {
              const applicant = await users.findByIdOrThrow(Number(application.get("user_id")));
              const relatedPosition = await application.position();
              const message = endedNotification({
                firstName: applicant.first_name,
                positionName: relatedPosition?.get("name") ?? "this position",
                recruiter: actor,
                to: applicant.email,
              });
              await notifyUser({ userId: applicant.id, ...message });
            }
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
            const id = Number(application.id);
            const statusId = Number(application.get("status_id"));
            if (statusId < STATUS.FEEDBACK) {
              await applications.updateById(id, { status_id: statusId + 1 });
              return jsonResponse(null);
            }
            if (statusId !== STATUS.FEEDBACK) {
              throw new ForbiddenError("Application cannot be moved further.");
            }
            if (!application.get("position_id")) {
              throw new UnprocessableEntityError("Application has no position.");
            }

            await runInTransaction(async () => {
              await applications.updateById(id, { status_id: STATUS.HIRED });
              const position = await application.position().first();
              if (!position) {
                throw new UnprocessableEntityError("Application has no position.");
              }
              const userId = Number(application.get("user_id"));
              const oldSeat = await positions.findByUserId(userId);
              if (oldSeat) {
                await positions.updateById(oldSeat.id, { user_id: null });
              }
              await position.update({ user_id: userId, hiring: false });

              const siblings = await position.applications();
              const rejectedIds: number[] = [];
              for (const sibling of siblings) {
                const siblingId = Number(sibling.id);
                if (siblingId !== id && Number(sibling.get("status_id")) !== STATUS.ENDED) {
                  await applications.updateById(siblingId, { status_id: STATUS.ENDED });
                  rejectedIds.push(Number(sibling.get("user_id")));
                }
              }

              const hired = await users.findByIdOrThrow(userId);
              const positionName = String(position.get("name"));
              await notifyUser({
                userId: hired.id,
                ...hiredNotification({
                  firstName: hired.first_name,
                  positionName,
                  recruiter: actor,
                  to: hired.email,
                }),
              });
              for (const rejectedId of rejectedIds) {
                const rejected = await users.findById(rejectedId);
                if (!rejected) continue;
                await notifyUser({
                  userId: rejected.id,
                  ...endedNotification({
                    firstName: rejected.first_name,
                    positionName,
                    recruiter: actor,
                    to: rejected.email,
                  }),
                });
              }
            });
            return jsonResponse(null);
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
        await authorize(request, "applications", "update");
        const rows: Array<Record<string, unknown>> = [];
        await Application.chunk(50, async (batch) => {
          for (const application of batch) {
            rows.push(application.toArray());
          }
        });
        const cursor = await Application.cursorPaginate({ perPage: 50 });
        return jsonResponse({
          count: rows.length,
          data: rows,
          cursor: {
            count: cursor.data.length,
            has_more: cursor.meta.has_more,
            next_cursor: cursor.meta.next_cursor,
          },
        });
      }),
    },
  };
}
