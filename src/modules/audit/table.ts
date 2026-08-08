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
    "previous_payload",
    "ip_address",
    "user_agent",
    "checksum",
    "tenant_id",
    "trace_id",
    "exported_at",
    "created_at",
  ],
  defaultOrderBy: { column: "created_at", direction: "DESC" },
});

export { auditLogTable };
