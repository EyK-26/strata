import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { verifyStripeWebhookSignature } from "@getstrata/core/security/stripeWebhook";

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

  test("rejects missing, malformed, stale, and invalid timestamps", () => {
    const secret = "whsec_test";
    const rawBody = '{"type":"customer.subscription.updated"}';

    expect(() => verifyStripeWebhookSignature(rawBody, null, secret)).toThrow(
      /Missing Stripe signature/,
    );
    expect(() => verifyStripeWebhookSignature(rawBody, "v1=only", secret)).toThrow(
      /Invalid Stripe signature header/,
    );
    expect(() => verifyStripeWebhookSignature(rawBody, "t=not-a-number,v1=abc", secret)).toThrow(
      /Invalid Stripe signature timestamp/,
    );

    const staleTimestamp = (Math.floor(Date.now() / 1000) - 600).toString();
    const staleSignature = createHmac("sha256", secret)
      .update(`${staleTimestamp}.${rawBody}`, "utf8")
      .digest("hex");

    expect(() =>
      verifyStripeWebhookSignature(
        rawBody,
        `t=${staleTimestamp},v1=${staleSignature}`,
        secret,
        300,
      ),
    ).toThrow(/timestamp is too old/);
  });
});
