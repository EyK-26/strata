import { createHmac } from "node:crypto";
import { repositoryConnection as db } from "@getstrata/core/database/repositoryConnection";
import { BadRequestError } from "@getstrata/core/errors/http";
import { Job } from "@getstrata/core/queue";
import { webhookSignatureHeader } from "@getstrata/core/runtime/appKeyPrefix";
import { safeFetch } from "@getstrata/core/security/safeFetch";
import { assertSafeOutboundUrl } from "@getstrata/core/security/safeUrl";
import { resolveTenant } from "@getstrata/core/tenant/resolveTenant";
import { runWithTenantDatabase } from "@getstrata/core/tenant/tenantDatabaseScope";

interface DispatchWebhookPayload {
  webhookId: number;
  tenantId: number;
  event: string;
  payload: Record<string, unknown>;
  url?: string;
  secret?: string;
}

class DispatchWebhookJob extends Job<DispatchWebhookPayload> {
  override readonly maxAttempts = 3;
  override readonly backoffMs = 2_000;

  override async handle(payload: DispatchWebhookPayload): Promise<void> {
    const tenantId = Number(payload.tenantId);
    const tenant = (await resolveTenant(tenantId)) ?? {
      id: tenantId,
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
    const queuedUrl = typeof payload.url === "string" ? payload.url : "";
    const queuedSecret = typeof payload.secret === "string" ? payload.secret : "";
    const queued =
      queuedUrl !== "" && queuedSecret !== ""
        ? { id: payload.webhookId, url: queuedUrl, secret: queuedSecret }
        : null;

    const rows = queued
      ? []
      : ((await db`
          SELECT id, url, secret
          FROM webhook
          WHERE id = ${payload.webhookId} AND active = TRUE
          LIMIT 1
        `) as Array<{ id: number; url: string; secret: string }>);

    const webhook = queued ?? rows[0];

    if (!webhook) {
      return;
    }

    const body = JSON.stringify({ event: payload.event, payload: payload.payload });
    const signature = createHmac("sha256", webhook.secret).update(body).digest("hex");

    const allowHttp = (process.env.APP_ENV ?? "local") !== "production";
    const signatureHeader = webhookSignatureHeader();

    let responseStatus: number | null = null;
    let errorMessage: string | null = null;

    try {
      assertSafeOutboundUrl(webhook.url, { allowHttp });
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

      if (error instanceof BadRequestError) {
        return;
      }

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
