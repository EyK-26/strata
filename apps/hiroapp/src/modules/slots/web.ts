import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { parseFormBody } from "@getstrata/bootstrap/web/forms";
import { redirectResponse } from "@getstrata/core/view";
import { bindModel } from "../../http/bind.ts";
import { requireCurrentUser } from "../../http/currentUser.ts";
import { wrapWebAuthenticated } from "../../http/wrap.ts";
import { Position } from "../../models/Position.ts";
import { Slot } from "../../models/Slot.ts";
import { slotService } from "./service.ts";

function returnTo(fields: Record<string, string>, fallback: string) {
  return fields.return_to || fallback;
}

export function slotWebRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/positions/:id/slots": {
      POST: wrapWebAuthenticated(
        dependencies,
        bindModel(
          "id",
          (id) => Position.findOrFail(id),
          async (request, position) => {
            const actor = await requireCurrentUser(request);
            const { fields } = await parseFormBody(request);
            await slotService.create(actor, position, {
              starts_at: fields.starts_at || fields.datetime || "",
              ends_at: fields.ends_at || "",
            });
            return redirectResponse(returnTo(fields, `/positions/${position.id}`));
          },
        ),
      ),
    },
    "/slots/:id/cancel": {
      POST: wrapWebAuthenticated(
        dependencies,
        bindModel(
          "id",
          (id) => Slot.findOrFail(id),
          async (request, slot) => {
            const actor = await requireCurrentUser(request);
            const { fields } = await parseFormBody(request);
            await slotService.cancel(actor, slot);
            return redirectResponse(returnTo(fields, `/positions/${slot.get("position_id")}`));
          },
        ),
      ),
    },
    "/slots/:id/book": {
      POST: wrapWebAuthenticated(
        dependencies,
        bindModel(
          "id",
          (id) => Slot.findOrFail(id),
          async (request, slot) => {
            const actor = await requireCurrentUser(request);
            const { fields } = await parseFormBody(request);
            await slotService.book(actor, slot);
            return redirectResponse(returnTo(fields, `/positions/${slot.get("position_id")}`));
          },
        ),
      ),
    },
  };
}
