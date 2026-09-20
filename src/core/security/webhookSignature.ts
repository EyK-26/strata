import { createHmac } from "node:crypto";
import { webhookSignatureHeader } from "../runtime/appKeyPrefix";

function signWebhookBody(secret: string, body: string | Buffer): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

function signedWebhookHeaders(secret: string, body: string | Buffer): Record<string, string> {
  return {
    [webhookSignatureHeader()]: signWebhookBody(secret, body),
  };
}

export { signedWebhookHeaders, signWebhookBody };
