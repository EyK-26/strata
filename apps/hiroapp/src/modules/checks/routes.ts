import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { jsonResponse } from "@getstrata/core/http/response";
import { bindModel } from "../../http/bind.ts";
import { requireCurrentUser } from "../../http/currentUser.ts";
import { wrapApi } from "../../http/wrap.ts";
import { Application } from "../../models/Application.ts";
import { BackgroundCheck } from "../../models/BackgroundCheck.ts";
import { RecordCheckRequest, RequestCheckRequest } from "./requests.ts";
import { backgroundCheckService, serializeBackgroundCheck } from "./service.ts";

export function backgroundCheckRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/api/applications/:id/background-check": {
      GET: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Application.findOrFail(id),
          async (request, application) => {
            const actor = await requireCurrentUser(request);
            return jsonResponse(await backgroundCheckService.forApplication(actor, application));
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
            const payload = await new RequestCheckRequest().validate(request);
            const created = await backgroundCheckService.request(actor, application, payload);
            return jsonResponse(serializeBackgroundCheck(created));
          },
        ),
      ),
    },
    "/api/background-checks/:id/clear": {
      POST: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => BackgroundCheck.findOrFail(id),
          async (request, check) => {
            const actor = await requireCurrentUser(request);
            const payload = await new RecordCheckRequest().validate(request);
            return jsonResponse(
              serializeBackgroundCheck(
                await backgroundCheckService.clear(actor, check, payload.notes),
              ),
            );
          },
        ),
      ),
    },
    "/api/background-checks/:id/flag": {
      POST: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => BackgroundCheck.findOrFail(id),
          async (request, check) => {
            const actor = await requireCurrentUser(request);
            const payload = await new RecordCheckRequest().validate(request);
            return jsonResponse(
              serializeBackgroundCheck(
                await backgroundCheckService.flag(actor, check, payload.notes),
              ),
            );
          },
        ),
      ),
    },
    "/api/background-checks/:id/cancel": {
      POST: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => BackgroundCheck.findOrFail(id),
          async (request, check) => {
            const actor = await requireCurrentUser(request);
            return jsonResponse(
              serializeBackgroundCheck(await backgroundCheckService.cancel(actor, check)),
            );
          },
        ),
      ),
    },
  };
}
