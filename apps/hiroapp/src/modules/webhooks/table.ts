import { defineTable } from "@getstrata/core/database/table";

export interface WebhookRecord {
  id: number;
  department_id: number | null;
  tenant_id: number;
  url: string;
  secret: string;
  events: string[] | unknown;
  active: boolean;
  created_at: Date;
}

export interface WebhookDeliveryRecord {
  id: number;
  webhook_id: number;
  tenant_id: number;
  event: string;
  payload: Record<string, unknown>;
  response_status: number | null;
  error: string | null;
  created_at: Date;
}

export const webhookTable = defineTable<WebhookRecord, "id">({
  name: "webhook",
  primaryKey: "id",
  columns: ["id", "department_id", "tenant_id", "url", "secret", "events", "active", "created_at"],
  defaultOrderBy: { column: "id", direction: "DESC" },
});

export const webhookDeliveryTable = defineTable<WebhookDeliveryRecord, "id">({
  name: "webhook_delivery",
  primaryKey: "id",
  columns: [
    "id",
    "webhook_id",
    "tenant_id",
    "event",
    "payload",
    "response_status",
    "error",
    "created_at",
  ],
  defaultOrderBy: { column: "id", direction: "DESC" },
});
