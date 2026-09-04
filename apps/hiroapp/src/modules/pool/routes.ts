import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { jsonResponse } from "@getstrata/core/http/response";
import { bindModel } from "../../http/bind.ts";
import { requireCurrentUser } from "../../http/currentUser.ts";
import { wrapApi } from "../../http/wrap.ts";
import { Application } from "../../models/Application.ts";
import { TalentPoolEntry } from "../../models/TalentPoolEntry.ts";
import { AddPoolFromApplicationRequest, AddPoolRequest, ReachOutRequest } from "./requests.ts";
import { serializePoolEntry, talentPoolService } from "./service.ts";

export function talentPoolRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/api/talent-pool": {
      GET: wrapApi(dependencies, async (request) => {
        const actor = await requireCurrentUser(request);
        return jsonResponse(await talentPoolService.list(actor));
      }),
      POST: wrapApi(dependencies, async (request) => {
        const actor = await requireCurrentUser(request);
        const payload = await new AddPoolRequest().validate(request);
        const created = await talentPoolService.add(actor, payload);
        return jsonResponse(serializePoolEntry(created));
      }),
    },
    "/api/talent-pool/:id/reach-out": {
      POST: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => TalentPoolEntry.findOrFail(id),
          async (request, entry) => {
            const actor = await requireCurrentUser(request);
            const payload = await new ReachOutRequest().validate(request);
            const result = await talentPoolService.reachOut(actor, entry, payload);
            return jsonResponse(result);
          },
        ),
      ),
    },
    "/api/talent-pool/:id/release": {
      POST: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => TalentPoolEntry.findOrFail(id),
          async (request, entry) => {
            const actor = await requireCurrentUser(request);
            return jsonResponse(serializePoolEntry(await talentPoolService.release(actor, entry)));
          },
        ),
      ),
    },
    "/api/applications/:id/talent-pool": {
      GET: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => Application.findOrFail(id),
          async (request, application) => {
            const actor = await requireCurrentUser(request);
            return jsonResponse(await talentPoolService.forApplication(actor, application));
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
            const payload = await new AddPoolFromApplicationRequest().validate(request);
            const created = await talentPoolService.addFromApplication(actor, application, payload);
            return jsonResponse(serializePoolEntry(created));
          },
        ),
      ),
    },
  };
}
