import { createHmac } from "node:crypto";
import { repositoryConnection as db } from "@getstrata/core/database/repositoryConnection";
import { Job } from "@getstrata/core/queue";
import { safeFetch } from "@getstrata/core/security/safeFetch";
import { assertSafeOutboundUrl } from "@getstrata/core/security/safeUrl";
import { resolveTenant } from "@getstrata/core/tenant/resolveTenant";
import { runWithTenantDatabase } from "@getstrata/core/tenant/tenantDatabaseScope";

interface DispatchWebhookPayload {
  webhookId: number;
  tenantId: number;
  event: string;
  payload: Record<string, unknown>;
}

class DispatchWebhookJob extends Job<DispatchWebhookPayload> {
  override readonly maxAttempts = 3;
  override readonly backoffMs = 2_000;

  override async handle(payload: DispatchWebhookPayload): Promise<void> {
    const tenant = (await resolveTenant(payload.tenantId)) ?? {
      id: payload.tenantId,
      slug: "job",
      plan: "free" as const,
      region: "eu" as const,
    };

    const failure = await runWithTenantDatabase(tenant, async () => await this.deliver(payload));

    if (failure) {
      throw failure;
    }
  }

  private async deliver(payload: DispatchWebhookPayload): Promise<Error | undefined> {
    const rows = (await db`
      SELECT id, url, secret
      FROM webhook
      WHERE id = ${payload.webhookId} AND active = TRUE
      LIMIT 1
    `) as Array<{ id: number; url: string; secret: string }>;

    const webhook = rows[0];

    if (!webhook) {
      return;
    }

    const body = JSON.stringify({ event: payload.event, payload: payload.payload });
    const signature = createHmac("sha256", webhook.secret).update(body).digest("hex");

    const allowHttp = (process.env.APP_ENV ?? "local") !== "production";
    const signatureHeader = process.env.WEBHOOK_SIGNATURE_HEADER?.trim() || "x-workhub-signature";

    assertSafeOutboundUrl(webhook.url, { allowHttp });

    let responseStatus: number | null = null;
    let errorMessage: string | null = null;

    try {
      const response = await safeFetch(
        webhook.url,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [signatureHeader]: signature,
          },
          body,
        },
        { allowHttp },
      );
      responseStatus = response.status;

      if (!response.ok) {
        throw new Error(`Webhook delivery failed with status ${response.status}.`);
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);

      await db`
        INSERT INTO webhook_delivery (webhook_id, event, payload, response_status, error)
        VALUES (
          ${webhook.id},
          ${payload.event},
          ${JSON.stringify(payload.payload)}::jsonb,
          ${responseStatus},
          ${errorMessage}
        )
      `;

      return error instanceof Error ? error : new Error(errorMessage);
    }

    await db`
      INSERT INTO webhook_delivery (webhook_id, event, payload, response_status)
      VALUES (
        ${webhook.id},
        ${payload.event},
        ${JSON.stringify(payload.payload)}::jsonb,
        ${responseStatus}
      )
    `;
  }
}

export { DispatchWebhookJob };
export default DispatchWebhookJob;
export type { DispatchWebhookPayload };
