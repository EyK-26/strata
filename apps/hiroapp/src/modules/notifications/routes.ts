import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { ForbiddenError } from "@getstrata/core/errors/http";
import { jsonResponse } from "@getstrata/core/http/response";
import { authorize, requireCurrentUser } from "../../http/currentUser.ts";
import { wrapApi } from "../../http/wrap.ts";
import { isStaff } from "../../lib/roles.ts";
import { serializeNotification } from "../../lib/serialize.ts";
import type { Notification } from "../../models/Notification.ts";
import { User } from "../../models/User.ts";
import { users } from "../users/repository.ts";
import { ContactUserRequest, MarkReadRequest } from "./requests.ts";
import { contactUserNotification, notifyUser } from "./service.ts";

export function notificationRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/api/notify": {
      POST: wrapApi(dependencies, async (request) => {
        const actor = await requireCurrentUser(request);
        if (!isStaff(actor.role_id)) {
          throw new ForbiddenError();
        }
        const payload = await new ContactUserRequest().validate(request);
        const recipient = await users.findByEmail(payload.to);
        if (recipient) {
          const message = contactUserNotification(
            payload.from,
            payload.to,
            payload.subject,
            payload.text,
          );
          await notifyUser({ userId: recipient.id, ...message });
        }
        return jsonResponse(null);
      }),
    },
    "/api/notify/get": {
      GET: wrapApi(dependencies, async (request) => {
        await authorize(request, "notifications", "view");
        const user = await requireCurrentUser(request);
        const rows = (await User.newFromRecord(user).notifications()) as Notification[];
        return jsonResponse(rows.map((row) => serializeNotification(row.toObject())));
      }),
    },
    "/api/notify/markasread": {
      POST: wrapApi(dependencies, async (request) => {
        const user = await authorize(request, "notifications", "update");
        const payload = await new MarkReadRequest().validate(request);
        const row = (await User.newFromRecord(user)
          .notifications()
          .where({ id: payload.id })
          .first()) as Notification | null;
        if (!row || row.get("read_at")) {
          return jsonResponse({ message: "error" });
        }
        await row.update({ read_at: new Date() });
        return jsonResponse({ message: "success" });
      }),
    },
  };
}
