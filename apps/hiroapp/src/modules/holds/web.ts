import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { parseFormBody } from "@getstrata/bootstrap/web/forms";
import { redirectResponse } from "@getstrata/core/view";
import { bindModel } from "../../http/bind.ts";
import { requireCurrentUser } from "../../http/currentUser.ts";
import { wrapWebAuthenticated } from "../../http/wrap.ts";
import { Application } from "../../models/Application.ts";
import { ApplicationHold } from "../../models/ApplicationHold.ts";
import { holdService } from "./service.ts";

function returnTo(fields: Record<string, string>, fallback: string) {
  return fields.return_to || fallback;
}

export function holdWebRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/applications/:id/hold": {
      POST: wrapWebAuthenticated(
        dependencies,
        bindModel(
          "id",
          (id) => Application.findOrFail(id),
          async (request, application) => {
            const actor = await requireCurrentUser(request);
            const { fields } = await parseFormBody(request);
            await holdService.hold(actor, application, { notes: fields.notes || null });
            return redirectResponse(returnTo(fields, `/applications/${application.id}`));
          },
        ),
      ),
    },
    "/holds/:id/release": {
      POST: wrapWebAuthenticated(
        dependencies,
        bindModel(
          "id",
          (id) => ApplicationHold.findOrFail(id),
          async (request, hold) => {
            const actor = await requireCurrentUser(request);
            const { fields } = await parseFormBody(request);
            await holdService.release(actor, hold);
            return redirectResponse(
              returnTo(fields, `/applications/${hold.get("application_id")}`),
            );
          },
        ),
      ),
    },
  };
}
