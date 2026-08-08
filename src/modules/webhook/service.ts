import { createHmac } from "node:crypto";
import db from "../../db/connection";
import WebhookRepository from "./repository";
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
    return await this.repository.create({
      organization_id: input.organizationId ?? null,
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

    for (const webhook of webhooks) {
      if (!this.matchesEvent(webhook.events, event)) {
        continue;
      }

      const body = JSON.stringify({ event, payload });
      const signature = createHmac("sha256", webhook.secret).update(body).digest("hex");
      let responseStatus: number | null = null;

      try {
        const response = await fetch(webhook.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-workhub-signature": signature,
          },
          body,
        });
        responseStatus = response.status;
      } catch {
        responseStatus = null;
      }

      await db`
        INSERT INTO webhook_delivery (webhook_id, event, payload, response_status)
        VALUES (${webhook.id}, ${event}, ${JSON.stringify(payload)}::jsonb, ${responseStatus})
      `;
    }
  }

  private matchesEvent(events: string[], event: string): boolean {
    return events.includes("*") || events.includes(event);
  }
}

export default WebhookService;
