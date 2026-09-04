import type { AppDependencies, AppRouteMap } from "@getstrata/bootstrap/contracts";
import { BadRequestError, UnauthorizedError } from "@getstrata/core/errors/http";
import { jsonResponse } from "@getstrata/core/http/response";
import { verifyStripeWebhookSignature } from "@getstrata/core/security/stripeWebhook";
import { currentTenantId } from "@getstrata/core/tenant/tenantContext";
import { denyUnless, requireCurrentUser } from "../../http/currentUser.ts";
import { wrapApi, wrapPublic } from "../../http/wrap.ts";
import { isStaff } from "../../lib/roles.ts";
import { iso } from "../../lib/serialize.ts";
import { billingService } from "./service.ts";
import type { BillingStatus } from "./table.ts";

function stripeStatus(value: string | undefined): BillingStatus {
  if (value === "active" || value === "trialing" || value === "past_due") {
    return value;
  }
  return "canceled";
}

export function billingRoutes(dependencies: AppDependencies): AppRouteMap {
  return {
    "/api/billing/subscription": {
      GET: wrapApi(dependencies, async (request) => {
        const user = await requireCurrentUser(request);
        denyUnless(isStaff(user.role_id), "Staff only.");
        const subscription = await billingService.getSubscriptionForTenant(currentTenantId());
        return jsonResponse({
          tenant_id: currentTenantId(),
          subscription: subscription
            ? {
                id: Number(subscription.id),
                plan: subscription.plan,
                status: subscription.status,
                stripe_subscription_id: subscription.stripe_subscription_id,
                current_period_end: iso(subscription.current_period_end),
              }
            : null,
        });
      }),
    },
    "/billing/webhooks/stripe": {
      POST: wrapPublic(async (request) => {
        const rawBody = await request.text();
        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
        if (!webhookSecret) {
          throw new UnauthorizedError("Stripe webhook secret is not configured.");
        }
        verifyStripeWebhookSignature(
          rawBody,
          request.headers.get("stripe-signature"),
          webhookSecret,
        );
        const payload = JSON.parse(rawBody) as {
          id?: string;
          type?: string;
          data?: { object?: { metadata?: { tenant_id?: string }; status?: string } };
        };
        const eventId = payload.id?.trim();
        if (!eventId) {
          throw new BadRequestError("Stripe event id is required.");
        }
        if (payload.type === "customer.subscription.updated") {
          const tenantId = Number.parseInt(payload.data?.object?.metadata?.tenant_id ?? "", 10);
          if (Number.isInteger(tenantId) && tenantId > 0) {
            const duplicate = await billingService.rememberStripeEvent(
              eventId,
              payload.type ?? "unknown",
              tenantId,
            );
            if (duplicate) {
              return jsonResponse({ received: true, duplicate: true });
            }
            await billingService.upsertSubscription({
              tenantId,
              plan: "pro",
              status: stripeStatus(payload.data?.object?.status),
            });
            return jsonResponse({ received: true });
          }
        }
        await billingService.rememberStripeEvent(eventId, payload.type ?? "unknown", null);
        return jsonResponse({ received: true });
      }),
    },
  };
}
