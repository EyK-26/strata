import type { AppDependencies } from "@getstrata/core/contracts/di";
import { resolveService } from "@getstrata/core/contracts/di";
import { BadRequestError, UnauthorizedError } from "@getstrata/core/errors/http";
import { jsonResponse, withErrorHandling } from "@getstrata/core/http/response";
import { verifyStripeWebhookSignature } from "@getstrata/core/security/stripeWebhook";
import { currentTenantId } from "@getstrata/core/tenant/tenantContext";
import db from "../../db/connection";
import { billingServiceToken } from "./provider";
import type BillingService from "./service";

class BillingController {
  constructor(private readonly dependencies: AppDependencies) {}

  private get service(): BillingService {
    return resolveService(this.dependencies, billingServiceToken);
  }

  readonly showSubscription = withErrorHandling(async () => {
    const subscription = await this.service.getSubscriptionForTenant(currentTenantId());

    return jsonResponse({
      tenant_id: currentTenantId(),
      subscription,
    });
  });

  readonly stripeWebhook = withErrorHandling(async (request: Request) => {
    const rawBody = await request.text();
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();

    if (!webhookSecret) {
      throw new UnauthorizedError("Stripe webhook secret is not configured.");
    }

    verifyStripeWebhookSignature(rawBody, request.headers.get("stripe-signature"), webhookSecret);

    const payload = JSON.parse(rawBody) as {
      id?: string;
      type?: string;
      data?: { object?: { metadata?: { tenant_id?: string }; status?: string } };
    };

    const eventId = payload.id?.trim();

    if (!eventId) {
      throw new BadRequestError("Stripe event id is required.");
    }

    const existing = (await db`
      SELECT id FROM stripe_webhook_event WHERE id = ${eventId} LIMIT 1
    `) as Array<{ id: string }>;

    if (existing.length > 0) {
      return jsonResponse({ received: true, duplicate: true });
    }

    if (payload.type === "customer.subscription.updated") {
      const tenantId = Number.parseInt(payload.data?.object?.metadata?.tenant_id ?? "", 10);
      const status = payload.data?.object?.status;

      if (Number.isInteger(tenantId) && tenantId > 0) {
        await this.service.upsertSubscription({
          tenantId,
          plan: "pro",
          status:
            status === "active" || status === "trialing" || status === "past_due"
              ? status
              : "canceled",
        });

        await db`
          INSERT INTO stripe_webhook_event (id, event_type, tenant_id)
          VALUES (${eventId}, ${payload.type ?? "unknown"}, ${tenantId})
        `;
      }
    } else {
      await db`
        INSERT INTO stripe_webhook_event (id, event_type, tenant_id)
        VALUES (${eventId}, ${payload.type ?? "unknown"}, NULL)
      `;
    }

    return jsonResponse({ received: true });
  });
}

export default BillingController;
