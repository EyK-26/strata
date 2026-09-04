import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { ForbiddenError } from "@getstrata/core/errors/http";
import { jsonResponse } from "@getstrata/core/http/response";
import { authorize, requireCurrentUser } from "../../http/currentUser.ts";
import { NotificationResource } from "../../http/resources.ts";
import { wrapApi } from "../../http/wrap.ts";
import { isStaff } from "../../lib/roles.ts";
import { inboxService } from "./inbox.ts";
import { ContactUserRequest, MarkReadRequest } from "./requests.ts";

export function notificationRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/api/notify": {
      POST: wrapApi(dependencies, async (request) => {
        const actor = await requireCurrentUser(request);
        if (!isStaff(actor.role_id)) {
          throw new ForbiddenError();
        }
        const payload = await new ContactUserRequest().validate(request);
        await inboxService.contact(payload);
        return jsonResponse(null);
      }),
    },
    "/api/notify/get": {
      GET: wrapApi(dependencies, async (request) => {
        await authorize(request, "notifications", "view");
        const user = await requireCurrentUser(request);
        const rows = await inboxService.list(user);
        return jsonResponse(rows.map((row) => new NotificationResource(row).toArray()));
      }),
    },
    "/api/notify/markasread": {
      POST: wrapApi(dependencies, async (request) => {
        const user = await authorize(request, "notifications", "update");
        const payload = await new MarkReadRequest().validate(request);
        const result = await inboxService.markRead(user, payload.id);
        return jsonResponse({ message: result.ok ? "success" : "error" });
      }),
    },
  };
}
