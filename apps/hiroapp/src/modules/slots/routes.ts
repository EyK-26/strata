import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { jsonResponse } from "@getstrata/core/http/response";
import { bindModel } from "../../http/bind.ts";
import { requireCurrentUser } from "../../http/currentUser.ts";
import { wrapApi } from "../../http/wrap.ts";
import { Position } from "../../models/Position.ts";
import { Slot } from "../../models/Slot.ts";
import { CreateSlotRequest } from "./requests.ts";
import { serializeSlot, slotService } from "./service.ts";

export function slotRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/api/positions/:id/slots": {
      GET: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Position.findOrFail(id),
          async (request, position) => {
            const actor = await requireCurrentUser(request);
            return jsonResponse(await slotService.listForPosition(actor, position));
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
            const payload = await new CreateSlotRequest().validate(request);
            const created = await slotService.create(actor, position, payload);
            return jsonResponse(serializeSlot(created));
          },
        ),
      ),
    },
    "/api/slots/:id/cancel": {
      POST: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Slot.findOrFail(id),
          async (request, slot) => {
            const actor = await requireCurrentUser(request);
            return jsonResponse(serializeSlot(await slotService.cancel(actor, slot)));
          },
        ),
      ),
    },
    "/api/slots/:id/book": {
      POST: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Slot.findOrFail(id),
          async (request, slot) => {
            const actor = await requireCurrentUser(request);
            return jsonResponse(serializeSlot(await slotService.book(actor, slot)));
          },
        ),
      ),
    },
  };
}
