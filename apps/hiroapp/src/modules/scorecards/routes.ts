import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { jsonResponse } from "@getstrata/core/http/response";
import { bindModel } from "../../http/bind.ts";
import { requireCurrentUser } from "../../http/currentUser.ts";
import { wrapApi } from "../../http/wrap.ts";
import { Interview } from "../../models/Interview.ts";
import { SubmitScorecardRequest } from "./requests.ts";
import { scorecardService, serializeScorecard } from "./service.ts";

export function scorecardRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/api/interviews/:id/scorecards": {
      GET: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Interview.findOrFail(id),
          async (request, interview) => {
            const actor = await requireCurrentUser(request);
            return jsonResponse(await scorecardService.listForInterview(actor, interview));
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
            const payload = await new SubmitScorecardRequest().validate(request);
            const saved = await scorecardService.submit(actor, interview, payload);
            return jsonResponse(serializeScorecard(saved));
          },
        ),
      ),
    },
  };
}
