interface AuditLogRecord {
  id: number;
  user_id: number | null;
  action: string;
  subject_type: string;
  subject_id: number | null;
  payload: Record<string, unknown>;
  created_at: Date;
}

export type { AuditLogRecord };
