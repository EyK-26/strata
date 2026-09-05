import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { formatCefLine, formatSiemAuditEvent } from "@getstrata/core/audit/siemFormatter";
import { jsonResponse } from "@getstrata/core/http/response";
import { denyUnless, requireCurrentUser } from "../../http/currentUser.ts";
import { wrapApi } from "../../http/wrap.ts";
import { isAdmin } from "../../lib/roles.ts";
import { iso } from "../../lib/serialize.ts";
import { auditService } from "./service.ts";

export function auditRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/api/audit-logs": {
      GET: wrapApi(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        denyUnless(isAdmin(user.role_id), "Admins only.");
        const rows = await auditService.listRecent();
        return jsonResponse(
          rows.map((row) => ({
            id: Number(row.id),
            user_id: row.user_id,
            action: row.action,
            subject_type: row.subject_type,
            subject_id: row.subject_id,
            payload: row.payload,
            created_at: iso(row.created_at),
          })),
        );
      }),
    },
    "/api/audit-logs/export": {
      GET: wrapApi(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        denyUnless(isAdmin(user.role_id), "Admins only.");
        const format = new URL(request.url).searchParams.get("format") === "cef" ? "cef" : "json";
        const rows = await auditService.listRecent(100);
        const events = rows.map((row) =>
          formatSiemAuditEvent({
            action: row.action,
            subject_type: row.subject_type,
            subject_id: row.subject_id,
            user_id: row.user_id,
            tenant_id: row.tenant_id ?? null,
            trace_id: row.trace_id ?? null,
            ip_address: row.ip_address,
            user_agent: row.user_agent,
            checksum: row.checksum,
            payload: row.payload,
            created_at: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
          }),
        );
        if (format === "cef") {
          return new Response(events.map((event) => formatCefLine(event)).join("\n"), {
            headers: { "content-type": "text/plain; charset=utf-8" },
          });
        }
        return jsonResponse({ data: events });
      }),
    },
  };
}
