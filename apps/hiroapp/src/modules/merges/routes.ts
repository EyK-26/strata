import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { jsonResponse } from "@getstrata/core/http/response";
import { requireCurrentUser } from "../../http/currentUser.ts";
import { wrapApi } from "../../http/wrap.ts";
import { CreateMergeRequest } from "./requests.ts";
import { mergeService, serializeMerge } from "./service.ts";

export function mergeRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/api/merges": {
      GET: wrapApi(dependencies, async (request) => {
        const actor = await requireCurrentUser(request);
        return jsonResponse(await mergeService.list(actor));
      }),
      POST: wrapApi(dependencies, async (request) => {
        const actor = await requireCurrentUser(request);
        const payload = await new CreateMergeRequest().validate(request);
        const created = await mergeService.merge(actor, payload);
        return jsonResponse(serializeMerge(created));
      }),
    },
  };
}
