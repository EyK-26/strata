import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { ValidationError } from "@getstrata/core/errors/http";
import { FormRequest } from "@getstrata/core/http/formRequest";
import { jsonResponse } from "@getstrata/core/http/response";
import { expectObject } from "@getstrata/core/http/validation";
import { denyUnless, requireCurrentUser } from "../../http/currentUser.ts";
import { wrapApi } from "../../http/wrap.ts";
import { isStaff } from "../../lib/roles.ts";
import { iso } from "../../lib/serialize.ts";
import { webhookService } from "./service.ts";

class CreateWebhookRequest extends FormRequest<{
  url: string;
  secret: string;
  events?: string[];
  department_id?: number | null;
}> {
  protected parse(payload: unknown) {
    const body = expectObject(payload);
    const url = typeof body.url === "string" ? body.url.trim() : "";
    const secret = typeof body.secret === "string" ? body.secret.trim() : "";
    if (!url) {
      throw new ValidationError("The given data was invalid.", {
        url: ["The url field is required."],
      });
    }
    if (!secret) {
      throw new ValidationError("The given data was invalid.", {
        secret: ["The secret field is required."],
      });
    }
    const events = Array.isArray(body.events) ? body.events.map(String) : undefined;
    const departmentId = body.department_id === undefined ? undefined : Number(body.department_id);
    return {
      url,
      secret,
      events,
      department_id:
        departmentId !== undefined && Number.isInteger(departmentId) && departmentId > 0
          ? departmentId
          : null,
    };
  }
}

function webhookId(request: Request): number {
  return Number((request as Request & { params?: { id?: string } }).params?.id);
}

function serializeWebhook(row: {
  id: number;
  url: string;
  events: unknown;
  active: boolean;
  department_id: number | null;
  created_at: Date;
}) {
  return {
    id: Number(row.id),
    url: row.url,
    events: row.events,
    active: Boolean(row.active),
    department_id: row.department_id,
    created_at: iso(row.created_at),
  };
}

export function webhookRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/api/webhooks": {
      GET: wrapApi(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        denyUnless(isStaff(user.role_id), "Staff only.");
        return jsonResponse((await webhookService.listAll()).map(serializeWebhook));
      }),
      POST: wrapApi(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        denyUnless(isStaff(user.role_id), "Staff only.");
        const payload = await new CreateWebhookRequest().validate(request);
        const created = await webhookService.create({
          url: payload.url,
          secret: payload.secret,
          events: payload.events,
          departmentId: payload.department_id,
        });
        return jsonResponse(serializeWebhook(created), { status: 201 });
      }),
    },
    "/api/webhooks/:id/deactivate": {
      POST: wrapApi(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        denyUnless(isStaff(user.role_id), "Staff only.");
        await webhookService.deactivate(webhookId(request));
        return jsonResponse({ active: false });
      }),
    },
    "/api/webhooks/:id": {
      DELETE: wrapApi(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        denyUnless(isStaff(user.role_id), "Staff only.");
        await webhookService.delete(webhookId(request));
        return jsonResponse({ deleted: true });
      }),
    },
  };
}
