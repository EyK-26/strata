import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { parseFormBody } from "@getstrata/bootstrap/web/forms";
import { redirectResponse } from "@getstrata/core/view";
import { bindModel } from "../../http/bind.ts";
import { authorize, requireCurrentUser } from "../../http/currentUser.ts";
import { wrapWebAuthenticated } from "../../http/wrap.ts";
import { Application } from "../../models/Application.ts";
import { Position } from "../../models/Position.ts";

export function commentWebRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/applications/:id/comments": {
      POST: wrapWebAuthenticated(
        dependencies,
        bindModel(
          "id",
          (id) => Application.findOrFail(id),
          async (request, application) => {
            const user = await requireCurrentUser(request);
            await authorize(request, "applications", "view", application.toObject());
            const { fields } = await parseFormBody(request);
            const body = String(fields.body ?? "").trim();
            if (body) {
              await application.comments().create({
                user_id: user.id,
                body,
              });
            }
            return redirectResponse(`/applications/${application.id}`);
          },
        ),
      ),
    },
    "/positions/:id/comments": {
      POST: wrapWebAuthenticated(
        dependencies,
        bindModel(
          "id",
          (id) => Position.findOrFail(id),
          async (request, position) => {
            const user = await requireCurrentUser(request);
            await authorize(request, "positions", "view");
            const { fields } = await parseFormBody(request);
            const body = String(fields.body ?? "").trim();
            if (body) {
              await position.comments().create({
                user_id: user.id,
                body,
              });
            }
            return redirectResponse(`/positions/${position.id}`);
          },
        ),
      ),
    },
  };
}
