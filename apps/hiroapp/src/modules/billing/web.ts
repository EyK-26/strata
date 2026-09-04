import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { currentTenantId } from "@getstrata/core/tenant/tenantContext";
import { denyUnless, requireCurrentUser } from "../../http/currentUser.ts";
import { renderPage } from "../../http/view.ts";
import { wrapWebAuthenticated } from "../../http/wrap.ts";
import { isStaff } from "../../lib/roles.ts";
import { iso } from "../../lib/serialize.ts";
import { billingService } from "./service.ts";

export function billingWebRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/billing": {
      GET: wrapWebAuthenticated(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        denyUnless(isStaff(user.role_id), "Staff only.");
        const subscription = await billingService.getSubscriptionForTenant(currentTenantId());
        return renderPage(request, "billing/show", {
          tenantId: currentTenantId(),
          subscription: subscription
            ? {
                plan: subscription.plan,
                status: subscription.status,
                period_end: iso(subscription.current_period_end),
              }
            : null,
        });
      }),
    },
  };
}
