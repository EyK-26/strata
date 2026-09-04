import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { parseFormBody } from "@getstrata/bootstrap/web/forms";
import { redirectResponse } from "@getstrata/core/view";
import { bindModel } from "../../http/bind.ts";
import { requireCurrentUser } from "../../http/currentUser.ts";
import { wrapWebAuthenticated } from "../../http/wrap.ts";
import { CandidateTag } from "../../models/CandidateTag.ts";
import { User } from "../../models/User.ts";
import { tagService } from "./service.ts";

function returnTo(fields: Record<string, string>, fallback: string) {
  return fields.return_to || fallback;
}

export function tagWebRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/users/:id/tags": {
      POST: wrapWebAuthenticated(
        dependencies,
        bindModel(
          "id",
          (id) => User.findOrFail(id),
          async (request, user) => {
            const actor = await requireCurrentUser(request);
            const { fields } = await parseFormBody(request);
            await tagService.add(actor, user, { label: fields.label || "" });
            return redirectResponse(returnTo(fields, `/users/${user.id}`));
          },
        ),
      ),
    },
    "/tags/:id/delete": {
      POST: wrapWebAuthenticated(
        dependencies,
        bindModel(
          "id",
          (id) => CandidateTag.findOrFail(id),
          async (request, tag) => {
            const actor = await requireCurrentUser(request);
            const { fields } = await parseFormBody(request);
            const removed = await tagService.remove(actor, tag);
            return redirectResponse(returnTo(fields, `/users/${removed.user_id}`));
          },
        ),
      ),
    },
  };
}
