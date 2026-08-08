import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { verifyStripeWebhookSignature } from "../../src/core/security/stripeWebhook";

describe("verifyStripeWebhookSignature", () => {
  test("accepts a valid Stripe signature", () => {
    const secret = "whsec_test";
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const rawBody = '{"type":"customer.subscription.updated"}';
    const signature = createHmac("sha256", secret)
      .update(`${timestamp}.${rawBody}`, "utf8")
      .digest("hex");

    expect(() =>
      verifyStripeWebhookSignature(rawBody, `t=${timestamp},v1=${signature}`, secret),
    ).not.toThrow();
  });

  test("rejects tampered payloads", () => {
    const secret = "whsec_test";
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const rawBody = '{"type":"customer.subscription.updated"}';
    const signature = createHmac("sha256", secret)
      .update(`${timestamp}.${rawBody}`, "utf8")
      .digest("hex");

    expect(() =>
      verifyStripeWebhookSignature(
        '{"type":"customer.subscription.deleted"}',
        `t=${timestamp},v1=${signature}`,
        secret,
      ),
    ).toThrow(/Invalid Stripe webhook signature/);
  });
});
