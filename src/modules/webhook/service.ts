import { resolveApplicationQueue } from "@getstrata/bootstrap/applicationRegistry";
import { repositoryConnection as db } from "@getstrata/core/database/repositoryConnection";
import { DispatchWebhookJob } from "@getstrata/core/jobs/dispatchWebhookJob";
import { createTrackedJob } from "@getstrata/core/queue/createAppQueue";
import { assertSafeOutboundUrlResolved } from "@getstrata/core/security/safeUrl";
import { currentTenantId } from "@getstrata/core/tenant/tenantContext";
import { appConfig } from "../../config/app";
import type WebhookRepository from "./repository";
import type { WebhookDeliveryRecord, WebhookRecord } from "./types";

interface CreateWebhookInput {
  organizationId?: number;
  url: string;
  secret: string;
  events?: string[];
}

class WebhookService {
  constructor(private readonly repository: WebhookRepository) {}

  async create(input: CreateWebhookInput): Promise<WebhookRecord> {
    await assertSafeOutboundUrlResolved(input.url, {
      allowHttp: appConfig.env !== "production",
      resolveDns: appConfig.env === "production",
    });

    return await this.repository.create({
      organization_id: input.organizationId ?? null,
      tenant_id: currentTenantId(),
      url: input.url,
      secret: input.secret,
      events: input.events ?? ["*"],
      active: true,
      created_at: new Date(),
    });
  }

  async listActive(): Promise<WebhookRecord[]> {
    return await this.repository.listActive();
  }

  async listAll(): Promise<WebhookRecord[]> {
    return await this.repository.findAll({
      orderBy: { column: "id", direction: "DESC" },
    });
  }

  async listRecentDeliveries(limit = 20): Promise<WebhookDeliveryRecord[]> {
    return (await db`
      SELECT id, webhook_id, event, payload, response_status, created_at
      FROM webhook_delivery
      ORDER BY id DESC
      LIMIT ${limit}
    `) as WebhookDeliveryRecord[];
  }

  async dispatch(event: string, payload: Record<string, unknown>): Promise<void> {
    const webhooks = await this.listActive();
    const queue = resolveApplicationQueue();
    const job = createTrackedJob("webhook.dispatch", new DispatchWebhookJob());

    for (const webhook of webhooks) {
      if (!this.matchesEvent(webhook.events, event)) {
        continue;
      }

      await queue.dispatch(job, {
        webhookId: webhook.id,
        tenantId: webhook.tenant_id,
        event,
        payload,
      });
    }
  }

  private matchesEvent(events: string[], event: string): boolean {
    return events.includes("*") || events.includes(event);
  }
}

export default WebhookService;
export type { CreateWebhookInput };
