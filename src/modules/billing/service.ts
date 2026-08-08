import db from "../../db/connection";

interface SubscriptionRecord {
  id: number;
  tenant_id: number;
  stripe_subscription_id: string | null;
  plan: "free" | "pro" | "enterprise";
  status: "active" | "past_due" | "canceled" | "trialing";
  current_period_end: Date | null;
  created_at: Date;
  updated_at: Date;
}

class BillingService {
  async getSubscriptionForTenant(tenantId: number): Promise<SubscriptionRecord | null> {
    const rows = (await db`
      SELECT
        id,
        tenant_id,
        stripe_subscription_id,
        plan,
        status,
        current_period_end,
        created_at,
        updated_at
      FROM subscription
      WHERE tenant_id = ${tenantId}
      ORDER BY id DESC
      LIMIT 1
    `) as SubscriptionRecord[];

    return rows[0] ?? null;
  }

  async upsertSubscription(input: {
    tenantId: number;
    plan: SubscriptionRecord["plan"];
    stripeSubscriptionId?: string;
    status?: SubscriptionRecord["status"];
  }): Promise<SubscriptionRecord> {
    const existing = await this.getSubscriptionForTenant(input.tenantId);
    const now = new Date();

    if (existing) {
      const rows = (await db`
        UPDATE subscription
        SET
          plan = ${input.plan},
          status = ${input.status ?? "active"},
          stripe_subscription_id = COALESCE(${input.stripeSubscriptionId ?? null}, stripe_subscription_id),
          updated_at = ${now}
        WHERE id = ${existing.id}
        RETURNING
          id,
          tenant_id,
          stripe_subscription_id,
          plan,
          status,
          current_period_end,
          created_at,
          updated_at
      `) as SubscriptionRecord[];

      await db`UPDATE tenant SET plan = ${input.plan} WHERE id = ${input.tenantId}`;
      const row = rows[0];

      if (!row) {
        throw new Error("Subscription update did not return a row.");
      }

      return row;
    }

    const rows = (await db`
      INSERT INTO subscription (tenant_id, plan, status, stripe_subscription_id, created_at, updated_at)
      VALUES (
        ${input.tenantId},
        ${input.plan},
        ${input.status ?? "active"},
        ${input.stripeSubscriptionId ?? null},
        ${now},
        ${now}
      )
      RETURNING
        id,
        tenant_id,
        stripe_subscription_id,
        plan,
        status,
        current_period_end,
        created_at,
        updated_at
    `) as SubscriptionRecord[];

    await db`UPDATE tenant SET plan = ${input.plan} WHERE id = ${input.tenantId}`;
    const row = rows[0];

    if (!row) {
      throw new Error("Subscription insert did not return a row.");
    }

    return row;
  }
}

export default BillingService;
export type { SubscriptionRecord };
