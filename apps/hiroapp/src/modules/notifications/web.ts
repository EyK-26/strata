import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { parseFormBody } from "@getstrata/bootstrap/web/forms";
import { routeParams } from "@getstrata/bootstrap/web/routing";
import { redirectResponse } from "@getstrata/core/view";
import { authorize, requireCurrentUser } from "../../http/currentUser.ts";
import { NotificationResource } from "../../http/resources.ts";
import { renderPage } from "../../http/view.ts";
import { wrapWebAuthenticated } from "../../http/wrap.ts";
import { inboxService } from "./inbox.ts";

export function notificationWebRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/inbox": {
      GET: wrapWebAuthenticated(dependencies, async (request) => {
        await authorize(request, "notifications", "view");
        const user = await requireCurrentUser(request);
        const rows = await inboxService.list(user);
        return renderPage(request, "notifications/index", {
          notifications: rows.map((row) => new NotificationResource(row).toArray()),
        });
      }),
    },
    "/inbox/:id/read": {
      POST: wrapWebAuthenticated(dependencies, async (request) => {
        const user = await authorize(request, "notifications", "update");
        const { fields } = await parseFormBody(request);
        await inboxService.markRead(user, routeParams(request).id);
        return redirectResponse(fields.return_to || "/inbox");
      }),
    },
  };
}
