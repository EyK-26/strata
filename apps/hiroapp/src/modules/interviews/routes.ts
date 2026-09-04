import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { jsonResponse } from "@getstrata/core/http/response";
import { assertValidSignature } from "@getstrata/core/http/signedUrl";
import { bindModel } from "../../http/bind.ts";
import { authorize, requireCurrentUser } from "../../http/currentUser.ts";
import { wrapApi } from "../../http/wrap.ts";
import { Application } from "../../models/Application.ts";
import { Interview } from "../../models/Interview.ts";
import {
  CompleteInterviewRequest,
  RescheduleInterviewRequest,
  ScheduleInterviewRequest,
} from "./requests.ts";
import { interviewService, serializeInterview } from "./service.ts";

export function interviewRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/api/interviews": {
      GET: wrapApi(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        const rows = await interviewService.listForActor(user);
        return jsonResponse(rows.map(serializeInterview));
      }),
      POST: wrapApi(dependencies, async (request) => {
        const actor = await authorize(request, "applications", "update");
        const payload = await new ScheduleInterviewRequest().validate(request);
        const created = await interviewService.schedule(actor, payload);
        return jsonResponse({
          ...serializeInterview(created.interview),
          confirm_url: created.confirm_url,
        });
      }),
    },
    "/api/applications/:id/interviews": {
      GET: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Application.findOrFail(id),
          async (request, application) => {
            const actor = await requireCurrentUser(request);
            const rows = await interviewService.listForApplication(actor, Number(application.id));
            return jsonResponse(rows.map(serializeInterview));
          },
        ),
      ),
    },
    "/api/interviews/:id/confirm": {
      GET: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Interview.findOrFail(id),
          async (request, interview) => {
            assertValidSignature(request);
            const actor = await requireCurrentUser(request);
            const updated = await interviewService.confirm(actor, interview);
            return jsonResponse({ confirmed: true, ...serializeInterview(updated) });
          },
        ),
      ),
      POST: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Interview.findOrFail(id),
          async (request, interview) => {
            const actor = await requireCurrentUser(request);
            const updated = await interviewService.confirm(actor, interview);
            return jsonResponse({ confirmed: true, ...serializeInterview(updated) });
          },
        ),
      ),
    },
    "/api/interviews/:id/complete": {
      POST: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Interview.findOrFail(id),
          async (request, interview) => {
            const actor = await authorize(request, "applications", "update");
            const payload = await new CompleteInterviewRequest().validate(request);
            const updated = await interviewService.complete(actor, interview, payload.notes);
            return jsonResponse(serializeInterview(updated));
          },
        ),
      ),
    },
    "/api/interviews/:id/cancel": {
      POST: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Interview.findOrFail(id),
          async (request, interview) => {
            const actor = await authorize(request, "applications", "update");
            const updated = await interviewService.cancel(actor, interview);
            return jsonResponse(serializeInterview(updated));
          },
        ),
      ),
    },
    "/api/interviews/:id/reschedule": {
      POST: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Interview.findOrFail(id),
          async (request, interview) => {
            const actor = await authorize(request, "applications", "update");
            const payload = await new RescheduleInterviewRequest().validate(request);
            const updated = await interviewService.reschedule(actor, interview, payload);
            return jsonResponse(serializeInterview(updated));
          },
        ),
      ),
    },
  };
}
