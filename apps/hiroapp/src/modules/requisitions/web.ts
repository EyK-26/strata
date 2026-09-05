import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { parseFormBody } from "@getstrata/bootstrap/web/forms";
import { redirectResponse } from "@getstrata/core/view";
import { bindModel } from "../../http/bind.ts";
import { requireCurrentUser } from "../../http/currentUser.ts";
import { renderPage } from "../../http/view.ts";
import { wrapWebAuthenticated } from "../../http/wrap.ts";
import { Position } from "../../models/Position.ts";
import { Requisition } from "../../models/Requisition.ts";
import { requisitionService } from "./service.ts";

function returnTo(fields: Record<string, string>, fallback: string) {
  return fields.return_to || fallback;
}

export function requisitionWebRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/requisitions": {
      GET: wrapWebAuthenticated(dependencies, async (request) => {
        const actor = await requireCurrentUser(request);
        return renderPage(request, "requisitions/index", {
          requisitions: await requisitionService.listSubmitted(actor),
        });
      }),
    },
    "/positions/:id/requisition": {
      POST: wrapWebAuthenticated(
        dependencies,
        bindModel(
          "id",
          (id) => Position.findOrFail(id),
          async (request, position) => {
            const actor = await requireCurrentUser(request);
            const { fields } = await parseFormBody(request);
            await requisitionService.submit(actor, position, { notes: fields.notes || null });
            return redirectResponse(returnTo(fields, `/positions/${position.id}`));
          },
        ),
      ),
    },
    "/requisitions/:id/approve": {
      POST: wrapWebAuthenticated(
        dependencies,
        bindModel(
          "id",
          (id) => Requisition.findOrFail(id),
          async (request, requisition) => {
            const actor = await requireCurrentUser(request);
            const { fields } = await parseFormBody(request);
            await requisitionService.approve(actor, requisition);
            return redirectResponse(
              returnTo(fields, `/positions/${requisition.get("position_id")}`),
            );
          },
        ),
      ),
    },
    "/requisitions/:id/reject": {
      POST: wrapWebAuthenticated(
        dependencies,
        bindModel(
          "id",
          (id) => Requisition.findOrFail(id),
          async (request, requisition) => {
            const actor = await requireCurrentUser(request);
            const { fields } = await parseFormBody(request);
            await requisitionService.reject(actor, requisition, fields.notes || null);
            return redirectResponse(
              returnTo(fields, `/positions/${requisition.get("position_id")}`),
            );
          },
        ),
      ),
    },
  };
}
