import { defineTable } from "@getstrata/core/database/table";
import type { NotificationRecord } from "./notificationTypes";

const notificationTable = defineTable<NotificationRecord, "id">({
  name: "notification",
  primaryKey: "id",
  columns: ["id", "user_id", "tenant_id", "type", "title", "body", "data", "read_at", "created_at"],
  defaultOrderBy: { column: "created_at", direction: "DESC" },
});

export { notificationTable };
