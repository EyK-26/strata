import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { parseFormBody } from "@getstrata/bootstrap/web/forms";
import { redirectResponse } from "@getstrata/core/view";
import { requireCurrentUser } from "../../http/currentUser.ts";
import { renderPage } from "../../http/view.ts";
import { wrapWebAuthenticated } from "../../http/wrap.ts";
import { mergeService } from "./service.ts";

function returnTo(fields: Record<string, string>, fallback: string) {
  return fields.return_to || fallback;
}

export function mergeWebRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/merges": {
      GET: wrapWebAuthenticated(dependencies, async (request) => {
        const actor = await requireCurrentUser(request);
        return renderPage(request, "merges/index", {
          merges: await mergeService.list(actor),
        });
      }),
      POST: wrapWebAuthenticated(dependencies, async (request) => {
        const actor = await requireCurrentUser(request);
        const { fields } = await parseFormBody(request);
        await mergeService.merge(actor, {
          source_id: Number(fields.source_id),
          target_id: Number(fields.target_id),
        });
        return redirectResponse(returnTo(fields, "/merges"));
      }),
    },
  };
}
