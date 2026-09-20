import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { webhookSignatureHeader } from "@getstrata/core/runtime/appKeyPrefix";
import { signedWebhookHeaders, signWebhookBody } from "@getstrata/core/security/webhookSignature";
import { restoreEnvVar } from "../helpers/restoreEnv";

describe("signWebhookBody", () => {
  test("published @getstrata/core/security/webhookSignature is exported", async () => {
    const pkg = JSON.parse(
      await readFile(join(import.meta.dir, "../../packages/strata-core/package.json"), "utf8"),
    ) as { exports: Record<string, unknown> };
    expect(pkg.exports["./security/webhookSignature"]).toBeDefined();
  });
  test("HMACs the JSON body and names the header from webhookSignatureHeader()", () => {
    const secret = "hook-secret";
    const body = JSON.stringify({ event: "notes.created", id: 1 });
    const signature = signWebhookBody(secret, body);

    expect(signature).toBe(createHmac("sha256", secret).update(body).digest("hex"));
    expect(signedWebhookHeaders(secret, body)).toEqual({
      [webhookSignatureHeader()]: signature,
    });
  });

  test("header name follows WEBHOOK_SIGNATURE_HEADER", () => {
    const previous = process.env.WEBHOOK_SIGNATURE_HEADER;
    process.env.WEBHOOK_SIGNATURE_HEADER = "x-shop-signature";
    try {
      expect(signedWebhookHeaders("s", "{}")["x-shop-signature"]).toBeDefined();
    } finally {
      restoreEnvVar("WEBHOOK_SIGNATURE_HEADER", previous);
    }
  });
});
