import { defineTable } from "@getstrata/core/database/table";

export interface AuditLogRecord {
  id: number;
  user_id: number | null;
  action: string;
  subject_type: string;
  subject_id: number | null;
  payload: Record<string, unknown>;
  previous_payload: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  checksum: string | null;
  tenant_id?: number | null;
  trace_id?: string | null;
  exported_at?: Date | null;
  created_at: Date;
}

export const auditLogTable = defineTable<AuditLogRecord, "id">({
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
