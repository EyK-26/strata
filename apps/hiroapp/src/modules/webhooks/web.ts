import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { parseFormBody } from "@getstrata/bootstrap/web/forms";
import { flashResponse } from "@getstrata/core/http/flashSession";
import { redirectResponse } from "@getstrata/core/view";
import { denyUnless, requireCurrentUser } from "../../http/currentUser.ts";
import { renderPage } from "../../http/view.ts";
import { wrapWebAuthenticated } from "../../http/wrap.ts";
import { isStaff } from "../../lib/roles.ts";
import { iso } from "../../lib/serialize.ts";
import { webhookService } from "./service.ts";

async function webhooksPage(request: Request, extras: Record<string, unknown> = {}) {
  const rows = await webhookService.listAll();
  const deliveries = await webhookService.listRecentDeliveries();
  return renderPage(request, "webhooks/index", {
    webhooks: rows.map((row) => ({
      id: Number(row.id),
      url: row.url,
      events: Array.isArray(row.events) ? row.events.join(", ") : "*",
      active: Boolean(row.active),
      created_at: iso(row.created_at),
    })),
    deliveries: deliveries.map((row) => ({
      id: Number(row.id),
      event: row.event,
      status: row.response_status,
      error: row.error,
      created_at: iso(row.created_at),
    })),
    ...extras,
  });
}

export function webhookWebRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/webhooks": {
      GET: wrapWebAuthenticated(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        denyUnless(isStaff(user.role_id), "Staff only.");
        return webhooksPage(request);
      }),
      POST: wrapWebAuthenticated(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        denyUnless(isStaff(user.role_id), "Staff only.");
        const { fields } = await parseFormBody(request);
        try {
          await webhookService.create({
            url: fields.url ?? "",
            secret: fields.secret ?? "",
            events: fields.events ? fields.events.split(",").map((entry) => entry.trim()) : ["*"],
          });
          return flashResponse(redirectResponse("/webhooks"), {
            level: "success",
            message: "Webhook created.",
          });
        } catch (error) {
          return webhooksPage(request, {
            error: error instanceof Error ? error.message : "Could not create webhook.",
          });
        }
      }),
    },
  };
}
