import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { jsonResponse } from "@getstrata/core/http/response";
import { bindModel } from "../../http/bind.ts";
import { requireCurrentUser } from "../../http/currentUser.ts";
import { wrapApi } from "../../http/wrap.ts";
import { Position } from "../../models/Position.ts";
import { Requisition } from "../../models/Requisition.ts";
import { RejectRequisitionRequest, SubmitRequisitionRequest } from "./requests.ts";
import { requisitionService, serializeRequisition } from "./service.ts";

export function requisitionRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/api/positions/:id/requisition": {
      GET: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Position.findOrFail(id),
          async (request, position) => {
            const actor = await requireCurrentUser(request);
            return jsonResponse(await requisitionService.forPosition(actor, position));
          },
        ),
      ),
      POST: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Position.findOrFail(id),
          async (request, position) => {
            const actor = await requireCurrentUser(request);
            const payload = await new SubmitRequisitionRequest().validate(request);
            const created = await requisitionService.submit(actor, position, payload);
            return jsonResponse(serializeRequisition(created));
          },
        ),
      ),
    },
    "/api/requisitions/:id/approve": {
      POST: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Requisition.findOrFail(id),
          async (request, requisition) => {
            const actor = await requireCurrentUser(request);
            return jsonResponse(
              serializeRequisition(await requisitionService.approve(actor, requisition)),
            );
          },
        ),
      ),
    },
    "/api/requisitions/:id/reject": {
      POST: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Requisition.findOrFail(id),
          async (request, requisition) => {
            const actor = await requireCurrentUser(request);
            const payload = await new RejectRequisitionRequest().validate(request);
            return jsonResponse(
              serializeRequisition(
                await requisitionService.reject(actor, requisition, payload.notes),
              ),
            );
          },
        ),
      ),
    },
  };
}
