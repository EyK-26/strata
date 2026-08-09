import { describe, expect, test } from "bun:test";
import db from "../../src/db/connection";
import BillingService from "../../src/modules/billing/service";

describe("BillingService", () => {
  test("returns null when no subscription exists for a tenant", async () => {
    const service = new BillingService();

    await expect(service.getSubscriptionForTenant(999_999)).resolves.toBeNull();
  });

  test("creates a subscription and updates the tenant plan", async () => {
    const service = new BillingService();

    const created = await service.upsertSubscription({
      tenantId: 1,
      plan: "pro",
      stripeSubscriptionId: "sub_new",
      status: "trialing",
    });

    expect(created.plan).toBe("pro");
    expect(created.status).toBe("trialing");
    expect(created.stripe_subscription_id).toBe("sub_new");

    const tenant = (await db`SELECT plan FROM tenant WHERE id = 1`) as Array<{ plan: string }>;
    expect(tenant[0]?.plan).toBe("pro");

    const fetched = await service.getSubscriptionForTenant(1);
    expect(fetched?.id).toBe(created.id);
  });

  test("updates an existing subscription without clearing stripe id when omitted", async () => {
    const service = new BillingService();

    const created = await service.upsertSubscription({
      tenantId: 1,
      plan: "pro",
      stripeSubscriptionId: "sub_existing",
    });

    const updated = await service.upsertSubscription({
      tenantId: 1,
      plan: "enterprise",
      status: "past_due",
    });

    expect(updated.id).toBe(created.id);
    expect(updated.plan).toBe("enterprise");
    expect(updated.status).toBe("past_due");
    expect(updated.stripe_subscription_id).toBe("sub_existing");
  });

  test("creates subscriptions with default active status", async () => {
    const service = new BillingService();

    const created = await service.upsertSubscription({
      tenantId: 1,
      plan: "free",
      stripeSubscriptionId: "sub_default_status",
    });

    expect(created.status).toBe("active");
  });
});
