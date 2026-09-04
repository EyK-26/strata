import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { parseFormBody } from "@getstrata/bootstrap/web/forms";
import { routeParams } from "@getstrata/bootstrap/web/routing";
import { parsePositiveIntParam } from "@getstrata/core/http/validation";
import { redirectResponse } from "@getstrata/core/view";
import { authorize, requireCurrentUser } from "../../http/currentUser.ts";
import { renderPage } from "../../http/view.ts";
import { wrapWebAuthenticated } from "../../http/wrap.ts";
import { iso } from "../../lib/serialize.ts";
import { Interview } from "../../models/Interview.ts";
import { interviewService, serializeInterview } from "./service.ts";

export function interviewWebRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/interviews": {
      GET: wrapWebAuthenticated(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        const rows = await interviewService.listForActor(user);
        return renderPage(request, "interviews/index", {
          interviews: rows.map((row) => ({
            ...serializeInterview(row),
            scheduled_at: iso(row.scheduled_at) ?? "",
          })),
        });
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
        const interview = await Interview.findOrFail(id);
        await interviewService.confirm(actor, interview);
        return redirectResponse("/interviews");
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
        const interview = await Interview.findOrFail(id);
        await interviewService.cancel(actor, interview);
        return redirectResponse("/interviews");
      }),
    },
  };
}
