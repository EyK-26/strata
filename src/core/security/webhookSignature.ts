import { createHmac } from "node:crypto";

function signWebhookBody(secret: string, body: string | Buffer): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

function signedWebhookHeaders(
  secret: string,
  body: string | Buffer,
  headerName = "x-strata-signature",
): Record<string, string> {
  return {
    [headerName]: signWebhookBody(secret, body),
  };
}

export { signedWebhookHeaders, signWebhookBody };
