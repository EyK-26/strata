import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { parseFormBody } from "@getstrata/bootstrap/web/forms";
import { redirectResponse } from "@getstrata/core/view";
import { bindModel } from "../../http/bind.ts";
import { requireCurrentUser } from "../../http/currentUser.ts";
import { wrapWebAuthenticated } from "../../http/wrap.ts";
import { Position } from "../../models/Position.ts";
import { Referral } from "../../models/Referral.ts";
import { referralService } from "./service.ts";

function returnTo(fields: Record<string, string>, fallback: string) {
  return fields.return_to || fallback;
}

export function referralWebRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/positions/:id/referrals": {
      POST: wrapWebAuthenticated(
        dependencies,
        bindModel(
          "id",
          (id) => Position.findOrFail(id),
          async (request, position) => {
            const actor = await requireCurrentUser(request);
            const { fields } = await parseFormBody(request);
            await referralService.create(actor, position, {
              email: fields.email ?? "",
              name: fields.name ?? "",
              notes: fields.notes || null,
            });
            return redirectResponse(returnTo(fields, `/positions/${position.id}`));
          },
        ),
      ),
    },
    "/referrals/:id/close": {
      POST: wrapWebAuthenticated(
        dependencies,
        bindModel(
          "id",
          (id) => Referral.findOrFail(id),
          async (request, referral) => {
            const actor = await requireCurrentUser(request);
            const { fields } = await parseFormBody(request);
            await referralService.close(actor, referral);
            return redirectResponse(returnTo(fields, `/positions/${referral.get("position_id")}`));
          },
        ),
      ),
    },
  };
}
