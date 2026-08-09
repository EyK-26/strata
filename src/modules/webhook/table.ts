import { defineTable } from "@getstrata/core/database";
import type { WebhookRecord } from "./types";

const webhookTable = defineTable<WebhookRecord, "id">({
  name: "webhook",
  primaryKey: "id",
  columns: [
    "id",
    "organization_id",
    "tenant_id",
    "url",
    "secret",
    "events",
    "active",
    "created_at",
  ],
});

export { webhookTable };
