import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { jsonResponse } from "@getstrata/core/http/response";
import { bindModel } from "../../http/bind.ts";
import { requireCurrentUser } from "../../http/currentUser.ts";
import { wrapApi } from "../../http/wrap.ts";
import { Application } from "../../models/Application.ts";
import { ApplicationHold } from "../../models/ApplicationHold.ts";
import { CreateHoldRequest } from "./requests.ts";
import { holdService, serializeHold } from "./service.ts";

export function holdRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/api/applications/:id/hold": {
      GET: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Application.findOrFail(id),
          async (request, application) => {
            const actor = await requireCurrentUser(request);
            return jsonResponse(await holdService.forApplication(actor, application));
          },
        ),
      ),
      POST: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Application.findOrFail(id),
          async (request, application) => {
            const actor = await requireCurrentUser(request);
            const payload = await new CreateHoldRequest().validate(request);
            const created = await holdService.hold(actor, application, payload);
            return jsonResponse(serializeHold(created));
          },
        ),
      ),
    },
    "/api/holds/:id/release": {
      POST: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => ApplicationHold.findOrFail(id),
          async (request, hold) => {
            const actor = await requireCurrentUser(request);
            return jsonResponse(serializeHold(await holdService.release(actor, hold)));
          },
        ),
      ),
    },
  };
}
