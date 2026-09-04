import { defineTable } from "@getstrata/core/database/table";

export interface NotificationRecord {
  id: string;
  type: string;
  notifiable_type: string;
  notifiable_id: number;
  data: Record<string, unknown> | string;
  read_at: Date | null;
  created_at: Date | null;
  updated_at: Date | null;
}

export const notificationTable = defineTable<NotificationRecord, "id">({
  name: "notifications",
  primaryKey: "id",
  columns: [
    "id",
    "type",
    "notifiable_type",
    "notifiable_id",
    "data",
    "read_at",
    "created_at",
    "updated_at",
  ],
  defaultOrderBy: { column: "created_at", direction: "DESC" },
});
