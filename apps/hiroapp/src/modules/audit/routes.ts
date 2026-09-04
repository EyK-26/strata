import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
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
  };
}
