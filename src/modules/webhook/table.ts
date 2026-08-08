import { defineTable } from "../../core/database";
import type { WebhookRecord } from "./types";

const webhookTable = defineTable<WebhookRecord, "id">({
  name: "webhook",
  primaryKey: "id",
  columns: ["id", "organization_id", "url", "secret", "events", "active", "created_at"],
});

export { webhookTable };
