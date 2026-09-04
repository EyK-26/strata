import { defineTable } from "@getstrata/core/database/table";

export type BillingPlan = "free" | "pro" | "enterprise";
export type BillingStatus = "active" | "past_due" | "canceled" | "trialing";

export interface SubscriptionRecord {
  id: number;
  tenant_id: number;
  stripe_subscription_id: string | null;
  plan: BillingPlan;
  status: BillingStatus;
  current_period_end: Date | null;
  created_at: Date;
  updated_at: Date;
}

export const subscriptionTable = defineTable<SubscriptionRecord, "id">({
  name: "subscription",
  primaryKey: "id",
  columns: [
    "id",
    "tenant_id",
    "stripe_subscription_id",
    "plan",
    "status",
    "current_period_end",
    "created_at",
    "updated_at",
  ],
  defaultOrderBy: { column: "id", direction: "DESC" },
});
