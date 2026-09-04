import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { parseFormBody } from "@getstrata/bootstrap/web/forms";
import { redirectResponse } from "@getstrata/core/view";
import { bindModel } from "../../http/bind.ts";
import { requireCurrentUser } from "../../http/currentUser.ts";
import { wrapWebAuthenticated } from "../../http/wrap.ts";
import { Application } from "../../models/Application.ts";
import { rejectionService } from "./service.ts";

export function rejectionWebRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/applications/:id/reject": {
      POST: wrapWebAuthenticated(
        dependencies,
        bindModel(
          "id",
          (id) => Application.findOrFail(id),
          async (request, application) => {
            const actor = await requireCurrentUser(request);
            const { fields } = await parseFormBody(request);
            await rejectionService.reject(actor, application, {
              reason_id: Number(fields.reason_id),
              notes: fields.notes || null,
            });
            return redirectResponse(fields.return_to || `/applications/${application.id}`);
          },
        ),
      ),
    },
  };
}
