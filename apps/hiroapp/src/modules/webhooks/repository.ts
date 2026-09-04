import { TenantRepository } from "../../lib/tenantRepository.ts";
import {
  type WebhookDeliveryRecord,
  type WebhookRecord,
  webhookDeliveryTable,
  webhookTable,
} from "./table.ts";

class WebhookRepository extends TenantRepository<WebhookRecord, "id"> {
  async listActive() {
    return this.findWhere({ active: true });
  }
}

class WebhookDeliveryRepository extends TenantRepository<WebhookDeliveryRecord, "id"> {
  async recent(limit = 20) {
    return this.findAll({ limit, orderBy: { column: "id", direction: "DESC" } });
  }
}

export const webhooks = new WebhookRepository(webhookTable);
export const webhookDeliveries = new WebhookDeliveryRepository(webhookDeliveryTable);
export type { WebhookDeliveryRecord, WebhookRecord };
