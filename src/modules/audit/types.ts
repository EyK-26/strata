interface AuditLogRecord {
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

export type { AuditLogRecord };
