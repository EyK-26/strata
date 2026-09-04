import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { parseFormBody } from "@getstrata/bootstrap/web/forms";
import { redirectResponse } from "@getstrata/core/view";
import { bindModel } from "../../http/bind.ts";
import { requireCurrentUser } from "../../http/currentUser.ts";
import { wrapWebAuthenticated } from "../../http/wrap.ts";
import { Interview } from "../../models/Interview.ts";
import { scorecardService } from "./service.ts";

export function scorecardWebRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/interviews/:id/scorecards": {
      POST: wrapWebAuthenticated(
        dependencies,
        bindModel(
          "id",
          (id) => Interview.findOrFail(id),
          async (request, interview) => {
            const actor = await requireCurrentUser(request);
            const { fields } = await parseFormBody(request);
            await scorecardService.submit(actor, interview, {
              overall_score: Number(fields.overall_score),
              recommendation: fields.recommendation ?? "",
              notes: fields.notes || null,
            });
            return redirectResponse(fields.return_to || "/interviews");
          },
        ),
      ),
    },
  };
}
