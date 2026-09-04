import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { parseFormBody } from "@getstrata/bootstrap/web/forms";
import { redirectResponse } from "@getstrata/core/view";
import { bindModel } from "../../http/bind.ts";
import { requireCurrentUser } from "../../http/currentUser.ts";
import { wrapWebAuthenticated } from "../../http/wrap.ts";
import { Application } from "../../models/Application.ts";
import { sourceService } from "./service.ts";

export function sourceWebRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/applications/:id/source": {
      POST: wrapWebAuthenticated(
        dependencies,
        bindModel(
          "id",
          (id) => Application.findOrFail(id),
          async (request, application) => {
            const actor = await requireCurrentUser(request);
            const { fields } = await parseFormBody(request);
            await sourceService.record(actor, application, {
              source_id: Number(fields.source_id),
              notes: fields.notes || null,
            });
            return redirectResponse(fields.return_to || `/applications/${application.id}`);
          },
        ),
      ),
    },
  };
}
