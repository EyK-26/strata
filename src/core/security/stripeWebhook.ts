import { createHmac, timingSafeEqual } from "node:crypto";
import { UnauthorizedError } from "../errors/http";

function verifyStripeWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
  toleranceSeconds = 300,
): void {
  if (!signatureHeader?.trim()) {
    throw new UnauthorizedError("Missing Stripe signature.");
  }

  const entries = signatureHeader.split(",").map((part) => part.trim());
  let timestamp: string | null = null;
  const signatures: string[] = [];

  for (const entry of entries) {
    const [key, value] = entry.split("=");

    if (key === "t" && value) {
      timestamp = value;
    }

    if (key === "v1" && value) {
      signatures.push(value);
    }
  }

  if (!timestamp || signatures.length === 0) {
    throw new UnauthorizedError("Invalid Stripe signature header.");
  }

  const timestampNumber = Number.parseInt(timestamp, 10);

  if (!Number.isFinite(timestampNumber)) {
    throw new UnauthorizedError("Invalid Stripe signature timestamp.");
  }

  const ageSeconds = Math.floor(Date.now() / 1000) - timestampNumber;

  if (ageSeconds > toleranceSeconds) {
    throw new UnauthorizedError("Stripe signature timestamp is too old.");
  }

  const payload = `${timestamp}.${rawBody}`;
  const expected = createHmac("sha256", secret).update(payload, "utf8").digest("hex");
  const expectedBuffer = Buffer.from(expected);

  const matched = signatures.some((signature) => {
    const actualBuffer = Buffer.from(signature);

    if (actualBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return timingSafeEqual(actualBuffer, expectedBuffer);
  });

  if (!matched) {
    throw new UnauthorizedError("Invalid Stripe webhook signature.");
  }
}

export { verifyStripeWebhookSignature };
