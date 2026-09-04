import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { parseFormBody } from "@getstrata/bootstrap/web/forms";
import { routeParams } from "@getstrata/bootstrap/web/routing";
import { parsePositiveIntParam } from "@getstrata/core/http/validation";
import { redirectResponse } from "@getstrata/core/view";
import { authorize, requireCurrentUser } from "../../http/currentUser.ts";
import { wrapWebAuthenticated } from "../../http/wrap.ts";
import { Application } from "../../models/Application.ts";
import { Position } from "../../models/Position.ts";

export function commentWebRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/applications/:id/comments": {
      POST: wrapWebAuthenticated(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        const id = parsePositiveIntParam(routeParams(request).id, "id");
        const application = await Application.findOrFail(id);
        await authorize(request, "applications", "view", application.toObject());
        const { fields } = await parseFormBody(request);
        const body = String(fields.body ?? "").trim();
        if (body) {
          await application.comments().create({
            user_id: user.id,
            body,
          });
        }
        return redirectResponse(`/applications/${id}`);
      }),
    },
    "/positions/:id/comments": {
      POST: wrapWebAuthenticated(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        await authorize(request, "positions", "view");
        const id = parsePositiveIntParam(routeParams(request).id, "id");
        const position = await Position.findOrFail(id);
        const { fields } = await parseFormBody(request);
        const body = String(fields.body ?? "").trim();
        if (body) {
          await position.comments().create({
            user_id: user.id,
            body,
          });
        }
        return redirectResponse(`/positions/${id}`);
      }),
    },
  };
}
