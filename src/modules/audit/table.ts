import { defineTable } from "../../core/database";
import type { AuditLogRecord } from "./types";

const auditLogTable = defineTable<AuditLogRecord, "id">({
  name: "audit_log",
  primaryKey: "id",
  columns: [
    "id",
    "user_id",
    "action",
    "subject_type",
    "subject_id",
    "payload",
    "created_at",
  ],
  defaultOrderBy: { column: "created_at", direction: "DESC" },
});

export { auditLogTable };
