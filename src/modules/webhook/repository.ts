import { BaseRepository } from "@getstrata/core/database/baseRepository";
import type { QueryWhere } from "@getstrata/core/database/types";
import { webhookTable } from "./table";
import type { WebhookDeliveryRecord, WebhookRecord } from "./types";

class WebhookRepository extends BaseRepository<WebhookRecord, "id"> {
  constructor() {
    super(webhookTable);
  }

  async listActive(): Promise<WebhookRecord[]> {
    return await this.findWhere({ active: true } as unknown as QueryWhere<WebhookRecord>);
  }

  async findDeliveryById(id: number): Promise<WebhookDeliveryRecord | null> {
    const rows = await this.connection.unsafe<WebhookDeliveryRecord>(
      `SELECT id, webhook_id, event, payload, response_status, created_at
       FROM webhook_delivery
       WHERE id = $1
       LIMIT 1`,
      [id],
    );

    return rows[0] ?? null;
  }
}

export default WebhookRepository;
