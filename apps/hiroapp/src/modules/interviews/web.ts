import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { parseFormBody } from "@getstrata/bootstrap/web/forms";
import { routeParams } from "@getstrata/bootstrap/web/routing";
import { parsePositiveIntParam } from "@getstrata/core/http/validation";
import { redirectResponse } from "@getstrata/core/view";
import { authorize, requireCurrentUser } from "../../http/currentUser.ts";
import { renderPage } from "../../http/view.ts";
import { wrapWebAuthenticated } from "../../http/wrap.ts";
import { isStaff } from "../../lib/roles.ts";
import { iso } from "../../lib/serialize.ts";
import { Interview } from "../../models/Interview.ts";
import { scorecardService } from "../scorecards/service.ts";
import { interviewService, serializeInterview } from "./service.ts";

export function interviewWebRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/interviews": {
      GET: wrapWebAuthenticated(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        const rows = await interviewService.listForActor(user);
        const interviews = await Promise.all(
          rows.map(async (row) => {
            const payload = {
              ...serializeInterview(row),
              scheduled_at: iso(row.scheduled_at) ?? "",
            };
            if (!isStaff(user.role_id)) {
              return payload;
            }
            const listed = await scorecardService.listForInterview(
              user,
              Interview.newFromRecord(row),
            );
            return {
              ...payload,
              scorecards: listed.data,
              scorecard_summary: listed.summary,
            };
          }),
        );
        return renderPage(request, "interviews/index", { interviews });
      }),
      POST: wrapWebAuthenticated(dependencies, async (request) => {
        const actor = await authorize(request, "applications", "update");
        const { fields } = await parseFormBody(request);
        const created = await interviewService.schedule(actor, {
          application_id: Number(fields.application_id),
          scheduled_at: fields.datetime || fields.scheduled_at || "",
          place: fields.place || null,
          notes: fields.notes || null,
          text: fields.text ?? "",
        });
        return redirectResponse(
          fields.return_to || `/applications/${created.interview.application_id}`,
        );
      }),
    },
    "/interviews/:id/confirm": {
      POST: wrapWebAuthenticated(dependencies, async (request) => {
        const actor = await requireCurrentUser(request);
        const id = parsePositiveIntParam(routeParams(request).id, "id");
        const { fields } = await parseFormBody(request);
        const interview = await Interview.findOrFail(id);
        await interviewService.confirm(actor, interview);
        return redirectResponse(fields.return_to || "/interviews");
      }),
    },
    "/interviews/:id/complete": {
      POST: wrapWebAuthenticated(dependencies, async (request) => {
        const actor = await authorize(request, "applications", "update");
        const id = parsePositiveIntParam(routeParams(request).id, "id");
        const { fields } = await parseFormBody(request);
        const interview = await Interview.findOrFail(id);
        await interviewService.complete(actor, interview, fields.notes || null);
        return redirectResponse(fields.return_to || "/interviews");
      }),
    },
    "/interviews/:id/cancel": {
      POST: wrapWebAuthenticated(dependencies, async (request) => {
        const actor = await authorize(request, "applications", "update");
        const id = parsePositiveIntParam(routeParams(request).id, "id");
        const { fields } = await parseFormBody(request);
        const interview = await Interview.findOrFail(id);
        await interviewService.cancel(actor, interview);
        return redirectResponse(fields.return_to || "/interviews");
      }),
    },
    "/interviews/:id/decline": {
      POST: wrapWebAuthenticated(dependencies, async (request) => {
        const actor = await requireCurrentUser(request);
        const id = parsePositiveIntParam(routeParams(request).id, "id");
        const { fields } = await parseFormBody(request);
        const interview = await Interview.findOrFail(id);
        await interviewService.decline(actor, interview);
        return redirectResponse(fields.return_to || "/interviews");
      }),
    },
    "/interviews/:id/no-show": {
      POST: wrapWebAuthenticated(dependencies, async (request) => {
        const actor = await authorize(request, "applications", "update");
        const id = parsePositiveIntParam(routeParams(request).id, "id");
        const { fields } = await parseFormBody(request);
        const interview = await Interview.findOrFail(id);
        await interviewService.noShow(actor, interview);
        return redirectResponse(fields.return_to || "/interviews");
      }),
    },
    "/interviews/:id/reschedule": {
      POST: wrapWebAuthenticated(dependencies, async (request) => {
        const actor = await authorize(request, "applications", "update");
        const id = parsePositiveIntParam(routeParams(request).id, "id");
        const { fields } = await parseFormBody(request);
        const interview = await Interview.findOrFail(id);
        await interviewService.reschedule(actor, interview, {
          scheduled_at: fields.datetime || fields.scheduled_at || "",
          place: Object.hasOwn(fields, "place") ? fields.place : undefined,
          text: fields.text,
        });
        return redirectResponse(fields.return_to || "/interviews");
      }),
    },
  };
}
