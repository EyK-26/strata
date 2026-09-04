import { CORE_QUEUE_TOKEN } from "@getstrata/core/contracts/serviceTokens";
import { NotFoundError } from "@getstrata/core/errors/http";
import type { Queue } from "@getstrata/core/queue";
import { jobRegistry } from "@getstrata/core/queue/jobRegistry";
import { appEnv } from "@getstrata/core/runtime/appKeyPrefix";
import { assertSafeOutboundUrlResolved } from "@getstrata/core/security/safeUrl";
import { currentTenantId } from "@getstrata/core/tenant/tenantContext";
import { appContainer } from "../../http/currentUser.ts";
import { DISPATCH_WEBHOOK_JOB, DispatchWebhookJob } from "../../jobs/dispatchWebhook.ts";
import {
  type WebhookDeliveryRecord,
  type WebhookRecord,
  webhookDeliveries,
  webhooks,
} from "./repository.ts";

export interface CreateWebhookInput {
  url: string;
  secret: string;
  events?: string[];
  departmentId?: number | null;
}

function eventList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String);
  }
  return [];
}

function matchesEvent(events: unknown, event: string): boolean {
  const listed = eventList(events);
  return listed.includes("*") || listed.includes(event);
}

function matchesDepartment(
  webhookDepartmentId: number | null,
  payloadDepartmentId: unknown,
): boolean {
  if (webhookDepartmentId == null) {
    return true;
  }
  return Number(payloadDepartmentId) === Number(webhookDepartmentId);
}

export class WebhookService {
  private queue(): Queue {
    return appContainer().resolve<Queue>(CORE_QUEUE_TOKEN);
  }

  private trackedJob() {
    return jobRegistry.track(DISPATCH_WEBHOOK_JOB, new DispatchWebhookJob());
  }

  async create(input: CreateWebhookInput): Promise<WebhookRecord> {
    await assertSafeOutboundUrlResolved(input.url, {
      allowHttp: appEnv() !== "production",
      resolveDns: appEnv() === "production",
    });
    return webhooks.create({
      department_id: input.departmentId ?? null,
      tenant_id: currentTenantId(),
      url: input.url,
      secret: input.secret,
      events: input.events && input.events.length > 0 ? input.events : ["*"],
      active: true,
      created_at: new Date(),
    });
  }

  async listAll(): Promise<WebhookRecord[]> {
    return webhooks.findAll({ orderBy: { column: "id", direction: "DESC" } });
  }

  async listRecentDeliveries(limit = 20): Promise<WebhookDeliveryRecord[]> {
    return webhookDeliveries.recent(limit);
  }

  async deactivate(id: number): Promise<WebhookRecord> {
    await this.requireWebhook(id);
    return webhooks.updateByIdOrThrow(id, { active: false });
  }

  async activate(id: number): Promise<WebhookRecord> {
    await this.requireWebhook(id);
    return webhooks.updateByIdOrThrow(id, { active: true });
  }

  async delete(id: number): Promise<void> {
    await this.requireWebhook(id);
    await webhooks.deleteById(id);
  }

  async requireWebhook(id: number): Promise<WebhookRecord> {
    const webhook = await webhooks.findById(id);
    if (!webhook) {
      throw new NotFoundError(`Webhook ${id} not found.`);
    }
    return webhook;
  }

  async dispatch(event: string, payload: Record<string, unknown>): Promise<void> {
    const rows = await webhooks.listActive();
    for (const webhook of rows) {
      if (!matchesEvent(webhook.events, event)) {
        continue;
      }
      if (!matchesDepartment(webhook.department_id, payload.department_id)) {
        continue;
      }
      await this.queue().dispatch(this.trackedJob(), {
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

export const webhookService = new WebhookService();
