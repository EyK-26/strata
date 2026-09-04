import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { parseFormBody } from "@getstrata/bootstrap/web/forms";
import { redirectResponse } from "@getstrata/core/view";
import { bindModel } from "../../http/bind.ts";
import { requireCurrentUser } from "../../http/currentUser.ts";
import { renderPage } from "../../http/view.ts";
import { wrapWebAuthenticated } from "../../http/wrap.ts";
import { CandidateTag } from "../../models/CandidateTag.ts";
import { User } from "../../models/User.ts";
import { tagService } from "./service.ts";

function returnTo(fields: Record<string, string>, fallback: string) {
  return fields.return_to || fallback;
}

export function tagWebRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/tags": {
      GET: wrapWebAuthenticated(dependencies, async (request) => {
        const actor = await requireCurrentUser(request);
        return renderPage(request, "tags/index", {
          tags: await tagService.list(actor),
        });
      }),
      POST: wrapWebAuthenticated(dependencies, async (request) => {
        const actor = await requireCurrentUser(request);
        const { fields } = await parseFormBody(request);
        const user = await User.findOrFail(Number(fields.user_id));
        await tagService.add(actor, user, { label: fields.label || "" });
        return redirectResponse(returnTo(fields, "/tags"));
      }),
    },
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
            await tagService.remove(actor, tag);
            return redirectResponse(returnTo(fields, "/tags"));
          },
        ),
      ),
    },
  };
}
