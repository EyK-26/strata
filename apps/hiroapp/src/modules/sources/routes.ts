import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { jsonResponse } from "@getstrata/core/http/response";
import { bindModel } from "../../http/bind.ts";
import { requireCurrentUser } from "../../http/currentUser.ts";
import { wrapApi } from "../../http/wrap.ts";
import { Application } from "../../models/Application.ts";
import { RecordSourceRequest } from "./requests.ts";
import { serializeAttribution, sourceService } from "./service.ts";

export function sourceRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/api/application-sources": {
      GET: wrapApi(dependencies, async (request) => {
        await requireCurrentUser(request);
        return jsonResponse(await sourceService.list());
      }),
    },
    "/api/applications/:id/source": {
      GET: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Application.findOrFail(id),
          async (request, application) => {
            const actor = await requireCurrentUser(request);
            return jsonResponse(await sourceService.forApplication(actor, application));
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
            const payload = await new RecordSourceRequest().validate(request);
            const saved = await sourceService.record(actor, application, payload);
            return jsonResponse(serializeAttribution(saved));
          },
        ),
      ),
    },
  };
}
