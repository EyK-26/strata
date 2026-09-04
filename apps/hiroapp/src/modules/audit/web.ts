import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { denyUnless, requireCurrentUser } from "../../http/currentUser.ts";
import { renderPage } from "../../http/view.ts";
import { wrapWebAuthenticated } from "../../http/wrap.ts";
import { isAdmin } from "../../lib/roles.ts";
import { iso } from "../../lib/serialize.ts";
import { auditService } from "./service.ts";

export function auditWebRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/audit-logs": {
      GET: wrapWebAuthenticated(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        denyUnless(isAdmin(user.role_id), "Admins only.");
        const logs = await auditService.listRecent();
        return renderPage(request, "audit/index", {
          logs: logs.map((row) => ({
            id: Number(row.id),
            action: row.action,
            subject_type: row.subject_type,
            subject_id: row.subject_id,
            created_at: iso(row.created_at),
          })),
        });
      }),
    },
  };
}
