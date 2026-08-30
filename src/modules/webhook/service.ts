import { resolveApplicationQueue } from "@getstrata/bootstrap/applicationRegistry";
import { repositoryConnection as db } from "@getstrata/core/database/repositoryConnection";
import { NotFoundError } from "@getstrata/core/errors/http";
import { createTrackedJob } from "@getstrata/core/queue/createAppQueue";
import { assertSafeOutboundUrlResolved } from "@getstrata/core/security/safeUrl";
import { currentTenantId } from "@getstrata/core/tenant/tenantContext";
import { appConfig } from "../../config/app";
import {
  matchesWebhookEvent,
  matchesWebhookOrganization,
  resolveWebhookOrganizationId,
} from "./dispatchScope";
import { DispatchWebhookJob } from "./dispatchWebhookJob";
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

  async deactivate(id: number): Promise<WebhookRecord> {
    await this.requireWebhook(id);
    return await this.repository.updateByIdOrThrow(id, { active: false });
  }

  async activate(id: number): Promise<WebhookRecord> {
    await this.requireWebhook(id);
    return await this.repository.updateByIdOrThrow(id, { active: true });
  }

  async delete(id: number): Promise<void> {
    await this.requireWebhook(id);
    await this.repository.deleteById(id);
  }

  async retryDelivery(deliveryId: number): Promise<void> {
    const delivery = await this.repository.findDeliveryById(deliveryId);

    if (!delivery) {
      throw new NotFoundError(`Webhook delivery ${deliveryId} not found.`);
    }

    const webhook = await this.requireWebhook(delivery.webhook_id);
    const rawPayload = delivery.payload as unknown;
    const payload =
      typeof rawPayload === "string"
        ? (JSON.parse(rawPayload) as Record<string, unknown>)
        : (rawPayload as Record<string, unknown>);
    const queue = resolveApplicationQueue();
    const job = createTrackedJob("webhook.dispatch", new DispatchWebhookJob());

    await queue.dispatch(job, {
      webhookId: webhook.id,
      tenantId: Number(webhook.tenant_id),
      url: webhook.url,
      secret: webhook.secret,
      event: delivery.event,
      payload,
    });
  }

  private async requireWebhook(id: number): Promise<WebhookRecord> {
    const webhook = await this.repository.findById(id);

    if (!webhook) {
      throw new NotFoundError(`Webhook ${id} not found.`);
    }

    return webhook;
  }

  async dispatch(event: string, payload: Record<string, unknown>): Promise<void> {
    const webhooks = await this.listActive();
    const organizationId = await resolveWebhookOrganizationId(payload);
    const queue = resolveApplicationQueue();
    const job = createTrackedJob("webhook.dispatch", new DispatchWebhookJob());

    for (const webhook of webhooks) {
      if (!matchesWebhookEvent(webhook.events, event)) {
        continue;
      }

      if (!matchesWebhookOrganization(webhook.organization_id, organizationId)) {
        continue;
      }

      await queue.dispatch(job, {
        webhookId: webhook.id,
        tenantId: Number(webhook.tenant_id),
        url: webhook.url,
        secret: webhook.secret,
        event,
        payload,
      });
    }
  }
}

export default WebhookService;
export type { CreateWebhookInput };
