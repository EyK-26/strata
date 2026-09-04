import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { jsonResponse } from "@getstrata/core/http/response";
import { bindModel } from "../../http/bind.ts";
import { requireCurrentUser } from "../../http/currentUser.ts";
import { wrapApi } from "../../http/wrap.ts";
import { Application } from "../../models/Application.ts";
import { RejectApplicationRequest } from "./requests.ts";
import { rejectionService, serializeRejection } from "./service.ts";

export function rejectionRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/api/rejection-reasons": {
      GET: wrapApi(dependencies, async (request) => {
        const actor = await requireCurrentUser(request);
        return jsonResponse(await rejectionService.listReasons(actor));
      }),
    },
    "/api/applications/:id/rejections": {
      GET: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Application.findOrFail(id),
          async (request, application) => {
            const actor = await requireCurrentUser(request);
            return jsonResponse(await rejectionService.forApplication(actor, application));
          },
        ),
      ),
    },
    "/api/applications/:id/reject": {
      POST: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Application.findOrFail(id),
          async (request, application) => {
            const actor = await requireCurrentUser(request);
            const payload = await new RejectApplicationRequest().validate(request);
            const created = await rejectionService.reject(actor, application, payload);
            return jsonResponse(serializeRejection(created));
          },
        ),
      ),
    },
  };
}
