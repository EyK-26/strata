import { resolveApplicationQueue } from "@getstrata/bootstrap/applicationRegistry";
import { DispatchWebhookJob } from "@getstrata/core/jobs/dispatchWebhookJob";
import { createTrackedJob } from "@getstrata/core/queue/createAppQueue";
import { assertSafeOutboundUrlResolved } from "@getstrata/core/security/safeUrl";
import { currentTenantId } from "@getstrata/core/tenant/tenantContext";
import { appConfig } from "../../config/app";
import type WebhookRepository from "./repository";
import type { WebhookRecord } from "./types";

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
