import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { jsonResponse } from "@getstrata/core/http/response";
import { bindModel } from "../../http/bind.ts";
import { requireCurrentUser } from "../../http/currentUser.ts";
import { wrapApi } from "../../http/wrap.ts";
import { Position } from "../../models/Position.ts";
import { Referral } from "../../models/Referral.ts";
import { CreateReferralRequest } from "./requests.ts";
import { referralService, serializeReferral } from "./service.ts";

export function referralRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/api/referrals": {
      GET: wrapApi(dependencies, async (request) => {
        const actor = await requireCurrentUser(request);
        return jsonResponse(await referralService.listForReferrer(actor));
      }),
    },
    "/api/positions/:id/referrals": {
      GET: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Position.findOrFail(id),
          async (request, position) => {
            const actor = await requireCurrentUser(request);
            return jsonResponse(await referralService.listForPosition(actor, position));
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
            const payload = await new CreateReferralRequest().validate(request);
            const created = await referralService.create(actor, position, payload);
            return jsonResponse(serializeReferral(created));
          },
        ),
      ),
    },
    "/api/referrals/:id/close": {
      POST: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Referral.findOrFail(id),
          async (request, referral) => {
            const actor = await requireCurrentUser(request);
            return jsonResponse(serializeReferral(await referralService.close(actor, referral)));
          },
        ),
      ),
    },
  };
}
