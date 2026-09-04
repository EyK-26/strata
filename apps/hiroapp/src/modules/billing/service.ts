import { repositoryConnection as db } from "@getstrata/core/database/repositoryConnection";
import { currentTenantId } from "@getstrata/core/tenant/tenantContext";
import { type SubscriptionRecord, subscriptions } from "./repository.ts";
import type { BillingPlan, BillingStatus } from "./table.ts";

export class BillingService {
  async getSubscriptionForTenant(tenantId = currentTenantId()): Promise<SubscriptionRecord | null> {
    return subscriptions.forTenant(tenantId);
  }

  async upsertSubscription(input: {
    tenantId: number;
    plan: BillingPlan;
    stripeSubscriptionId?: string;
    status?: BillingStatus;
  }): Promise<SubscriptionRecord> {
    const existing = await subscriptions.forTenant(input.tenantId);
    const now = new Date();
    if (existing) {
      const updated = await subscriptions.updateByIdOrThrow(existing.id, {
        plan: input.plan,
        status: input.status ?? "active",
        stripe_subscription_id: input.stripeSubscriptionId ?? existing.stripe_subscription_id,
        updated_at: now,
      });
      await db`UPDATE tenant SET plan = ${input.plan} WHERE id = ${input.tenantId}`;
      return updated;
    }
    const created = await subscriptions.create({
      tenant_id: input.tenantId,
      plan: input.plan,
      status: input.status ?? "active",
      stripe_subscription_id: input.stripeSubscriptionId ?? null,
      current_period_end: null,
      created_at: now,
      updated_at: now,
    });
    await db`UPDATE tenant SET plan = ${input.plan} WHERE id = ${input.tenantId}`;
    return created;
  }

  async rememberStripeEvent(
    eventId: string,
    eventType: string,
    tenantId: number | null,
  ): Promise<boolean> {
    const existing = (await db`
      SELECT id FROM stripe_webhook_event WHERE id = ${eventId} LIMIT 1
    `) as Array<{ id: string }>;
    if (existing.length > 0) {
      return true;
    }
    await db`
      INSERT INTO stripe_webhook_event (id, event_type, tenant_id)
      VALUES (${eventId}, ${eventType}, ${tenantId})
    `;
    return false;
  }
}

export const billingService = new BillingService();
