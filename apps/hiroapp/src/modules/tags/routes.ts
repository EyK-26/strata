import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { jsonResponse } from "@getstrata/core/http/response";
import { bindModel } from "../../http/bind.ts";
import { requireCurrentUser } from "../../http/currentUser.ts";
import { wrapApi } from "../../http/wrap.ts";
import { CandidateTag } from "../../models/CandidateTag.ts";
import { User } from "../../models/User.ts";
import { CreateTagRequest } from "./requests.ts";
import { serializeTag, tagService } from "./service.ts";

export function tagRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/api/users/:id/tags": {
      GET: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => User.findOrFail(id),
          async (request, user) => {
            const actor = await requireCurrentUser(request);
            return jsonResponse(await tagService.listForUser(actor, user));
          },
        ),
      ),
      POST: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => User.findOrFail(id),
          async (request, user) => {
            const actor = await requireCurrentUser(request);
            const payload = await new CreateTagRequest().validate(request);
            const created = await tagService.add(actor, user, payload);
            return jsonResponse(serializeTag(created));
          },
        ),
      ),
    },
    "/api/tags/:id/delete": {
      POST: wrapApi(
        dependencies,
        bindModel(
          "id",
          (id) => CandidateTag.findOrFail(id),
          async (request, tag) => {
            const actor = await requireCurrentUser(request);
            return jsonResponse(await tagService.remove(actor, tag));
          },
        ),
      ),
    },
  };
}
