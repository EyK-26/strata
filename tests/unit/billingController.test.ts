import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { ServiceContainer } from "@getstrata/bootstrap/contracts";
import { runWithTenant } from "../../src/core/tenant/tenantContext";
import db from "../../src/db/connection";
import BillingController from "../../src/modules/billing/controller";
import { billingServiceToken } from "../../src/modules/billing/provider";
import BillingService from "../../src/modules/billing/service";
import { createMockCache, createMockDependencies } from "./testHelpers";

function stripeSignature(rawBody: string, secret: string): string {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex");

  return `t=${timestamp},v1=${signature}`;
}

describe("BillingController", () => {
  function createController(): BillingController {
    const container = new ServiceContainer();
    container.set(billingServiceToken, new BillingService());

    return new BillingController(createMockDependencies(container, createMockCache()));
  }

  test("returns the current tenant subscription", async () => {
    const controller = createController();
    const service = new BillingService();

    await service.upsertSubscription({
      tenantId: 1,
      plan: "pro",
      status: "active",
    });

    const response = await runWithTenant(
      { id: 1, slug: "default", plan: "pro", region: "eu" },
      () => controller.showSubscription(),
    );

    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      tenant_id: number;
      subscription: { plan: string } | null;
    };

    expect(body.tenant_id).toBe(1);
    expect(body.subscription?.plan).toBe("pro");
  });

  test("rejects stripe webhooks when the secret is missing", async () => {
    const previousSecret = process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_WEBHOOK_SECRET;

    try {
      const controller = createController();
      const response = await controller.stripeWebhook(
        new Request("https://example.test/webhooks/stripe", {
          method: "POST",
          body: '{"id":"evt_missing_secret"}',
        }),
      );

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        error: "Stripe webhook secret is not configured.",
      });
    } finally {
      process.env.STRIPE_WEBHOOK_SECRET = previousSecret;
    }
  });

  test("requires a stripe event id", async () => {
    const secret = "whsec_billing_controller";
    process.env.STRIPE_WEBHOOK_SECRET = secret;

    const rawBody = '{"type":"invoice.paid"}';
    const controller = createController();
    const response = await controller.stripeWebhook(
      new Request("https://example.test/webhooks/stripe", {
        method: "POST",
        headers: { "stripe-signature": stripeSignature(rawBody, secret) },
        body: rawBody,
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Stripe event id is required." });
  });

  test("returns duplicate for already processed stripe events", async () => {
    const secret = "whsec_billing_duplicate";
    process.env.STRIPE_WEBHOOK_SECRET = secret;

    await db`
      INSERT INTO stripe_webhook_event (id, event_type, tenant_id)
      VALUES ('evt_duplicate', 'invoice.paid', NULL)
    `;

    const rawBody = '{"id":"evt_duplicate","type":"invoice.paid"}';
    const controller = createController();
    const response = await controller.stripeWebhook(
      new Request("https://example.test/webhooks/stripe", {
        method: "POST",
        headers: { "stripe-signature": stripeSignature(rawBody, secret) },
        body: rawBody,
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, duplicate: true });
  });

  test("updates subscriptions for customer.subscription.updated events", async () => {
    const secret = "whsec_billing_subscription";
    process.env.STRIPE_WEBHOOK_SECRET = secret;

    const rawBody = JSON.stringify({
      id: "evt_subscription_updated",
      type: "customer.subscription.updated",
      data: {
        object: {
          metadata: { tenant_id: "1" },
          status: "trialing",
        },
      },
    });

    const controller = createController();
    const response = await controller.stripeWebhook(
      new Request("https://example.test/webhooks/stripe", {
        method: "POST",
        headers: { "stripe-signature": stripeSignature(rawBody, secret) },
        body: rawBody,
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });

    const subscription = (await db`
      SELECT plan, status
      FROM subscription
      WHERE tenant_id = 1
      ORDER BY id DESC
      LIMIT 1
    `) as Array<{ plan: string; status: string }>;

    expect(subscription[0]?.plan).toBe("pro");
    expect(subscription[0]?.status).toBe("trialing");

    const event = (await db`
      SELECT event_type, tenant_id
      FROM stripe_webhook_event
      WHERE id = 'evt_subscription_updated'
      LIMIT 1
    `) as Array<{ event_type: string; tenant_id: number | null }>;

    expect(event[0]?.event_type).toBe("customer.subscription.updated");
    expect(event[0]?.tenant_id).toBe(1);
  });

  test("maps unknown subscription statuses to canceled", async () => {
    const secret = "whsec_billing_canceled";
    process.env.STRIPE_WEBHOOK_SECRET = secret;

    const rawBody = JSON.stringify({
      id: "evt_subscription_canceled",
      type: "customer.subscription.updated",
      data: {
        object: {
          metadata: { tenant_id: "1" },
          status: "incomplete_expired",
        },
      },
    });

    const controller = createController();
    await controller.stripeWebhook(
      new Request("https://example.test/webhooks/stripe", {
        method: "POST",
        headers: { "stripe-signature": stripeSignature(rawBody, secret) },
        body: rawBody,
      }),
    );

    const subscription = (await db`
      SELECT status
      FROM subscription
      WHERE tenant_id = 1
      ORDER BY id DESC
      LIMIT 1
    `) as Array<{ status: string }>;

    expect(subscription[0]?.status).toBe("canceled");
  });

  test("records non-subscription stripe events with a null tenant id", async () => {
    const secret = "whsec_billing_other";
    process.env.STRIPE_WEBHOOK_SECRET = secret;

    const rawBody = JSON.stringify({
      id: "evt_invoice_paid",
      type: "invoice.paid",
    });

    const controller = createController();
    const response = await controller.stripeWebhook(
      new Request("https://example.test/webhooks/stripe", {
        method: "POST",
        headers: { "stripe-signature": stripeSignature(rawBody, secret) },
        body: rawBody,
      }),
    );

    expect(response.status).toBe(200);

    const event = (await db`
      SELECT event_type, tenant_id
      FROM stripe_webhook_event
      WHERE id = 'evt_invoice_paid'
      LIMIT 1
    `) as Array<{ event_type: string; tenant_id: number | null }>;

    expect(event[0]?.event_type).toBe("invoice.paid");
    expect(event[0]?.tenant_id).toBeNull();
  });

  test("ignores subscription updates with invalid tenant metadata", async () => {
    const secret = "whsec_billing_invalid_tenant";
    process.env.STRIPE_WEBHOOK_SECRET = secret;

    const rawBody = JSON.stringify({
      id: "evt_invalid_tenant",
      type: "customer.subscription.updated",
      data: {
        object: {
          metadata: { tenant_id: "not-a-number" },
          status: "active",
        },
      },
    });

    const controller = createController();
    const response = await controller.stripeWebhook(
      new Request("https://example.test/webhooks/stripe", {
        method: "POST",
        headers: { "stripe-signature": stripeSignature(rawBody, secret) },
        body: rawBody,
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });

    const event = (await db`
      SELECT id FROM stripe_webhook_event WHERE id = 'evt_invalid_tenant' LIMIT 1
    `) as Array<{ id: string }>;

    expect(event).toHaveLength(0);
  });
});
