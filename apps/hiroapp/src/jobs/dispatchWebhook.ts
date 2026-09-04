import { createHmac } from "node:crypto";
import { repositoryConnection as db } from "@getstrata/core/database/repositoryConnection";
import { Job } from "@getstrata/core/queue";
import { webhookSignatureHeader } from "@getstrata/core/runtime/appKeyPrefix";
import { safeFetch } from "@getstrata/core/security/safeFetch";
import { assertSafeOutboundUrl } from "@getstrata/core/security/safeUrl";
import type { TenantContext } from "@getstrata/core/tenant/tenantContext";
import { runWithTenantDatabase } from "@getstrata/core/tenant/tenantDatabaseScope";

export interface DispatchWebhookPayload {
  webhookId: number;
  tenantId: number;
  event: string;
  payload: Record<string, unknown>;
  url?: string;
  secret?: string;
}

export const DISPATCH_WEBHOOK_JOB = "hiroapp.webhook.dispatch";

function skipOutboundFetch(url: string): boolean {
  if ((process.env.APP_ENV ?? "local") === "testing") {
    return true;
  }
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === "example.com" || hostname.endsWith(".example.com");
  } catch {
    return true;
  }
}

export class DispatchWebhookJob extends Job<DispatchWebhookPayload> {
  override readonly maxAttempts = 3;
  override readonly backoffMs = 2_000;

  override async handle(payload: DispatchWebhookPayload): Promise<void> {
    const tenantId = Number(payload.tenantId);
    const rows = (await db`
      SELECT id, slug, plan, region
      FROM tenant
      WHERE id = ${tenantId}
      LIMIT 1
    `) as Array<TenantContext>;
    const tenant = rows[0] ?? {
      id: tenantId,
      slug: "job",
      plan: "free" as const,
      region: "eu" as const,
    };
    await runWithTenantDatabase(tenant, async () => {
      await this.deliver(payload);
    });
  }

  private async deliver(payload: DispatchWebhookPayload): Promise<void> {
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
    let responseStatus: number | null = null;
    let errorMessage: string | null = null;

    if (skipOutboundFetch(webhook.url)) {
      responseStatus = 204;
    } else {
      try {
        assertSafeOutboundUrl(webhook.url, { allowHttp });
        const response = await safeFetch(
          webhook.url,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              [webhookSignatureHeader()]: signature,
            },
            body,
          },
          { allowHttp, timeoutMs: 2_000 },
        );
        responseStatus = response.status;
        if (response.status < 200 || response.status >= 300) {
          errorMessage = `Webhook delivery failed with status ${response.status}`;
        }
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : String(error);
      }
    }

    await db`
      INSERT INTO webhook_delivery (webhook_id, tenant_id, event, payload, response_status, error)
      VALUES (
        ${webhook.id},
        ${payload.tenantId},
        ${payload.event},
        ${JSON.stringify(payload.payload)}::jsonb,
        ${responseStatus},
        ${errorMessage}
      )
    `;
  }
}
