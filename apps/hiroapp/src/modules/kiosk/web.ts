import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { parseFormBody } from "@getstrata/bootstrap/web/forms";
import { redirectResponse } from "@getstrata/core/view";
import { requireCurrentUser } from "../../http/currentUser.ts";
import { renderPage } from "../../http/view.ts";
import { wrapWebAuthenticated } from "../../http/wrap.ts";
import { kioskService } from "./service.ts";

export function kioskWebRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/kiosk": {
      GET: wrapWebAuthenticated(dependencies, async (request) => {
        const actor = await requireCurrentUser(request);
        const rows = await kioskService.list(actor);
        return renderPage(request, "kiosk/index", { rows });
      }),
      POST: wrapWebAuthenticated(dependencies, async (request) => {
        const actor = await requireCurrentUser(request);
        const { fields } = await parseFormBody(request);
        if (fields.intent === "sync") {
          await kioskService.sync(actor);
        } else {
          await kioskService.save(actor, {
            interview_id: Number(fields.interview_id),
            overall_score: Number(fields.overall_score),
            recommendation: fields.recommendation ?? "",
            notes: fields.notes || null,
          });
        }
        return redirectResponse("/kiosk");
      }),
    },
  };
}
