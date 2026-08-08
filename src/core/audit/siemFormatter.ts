interface SiemAuditEvent {
  timestamp: string;
  event_type: string;
  actor_user_id: number | null;
  tenant_id: number | null;
  trace_id: string | null;
  action: string;
  subject_type: string;
  subject_id: number | null;
  ip_address: string | null;
  user_agent: string | null;
  checksum: string | null;
  payload: Record<string, unknown>;
}

function formatSiemAuditEvent(input: {
  action: string;
  subject_type: string;
  subject_id: number | null;
  user_id: number | null;
  tenant_id?: number | null;
  trace_id?: string | null;
  ip_address?: string | null;
  user_agent?: string | null;
  checksum?: string | null;
  payload?: Record<string, unknown>;
  created_at: Date;
}): SiemAuditEvent {
  return {
    timestamp: input.created_at.toISOString(),
    event_type: "workhub.audit",
    actor_user_id: input.user_id,
    tenant_id: input.tenant_id ?? null,
    trace_id: input.trace_id ?? null,
    action: input.action,
    subject_type: input.subject_type,
    subject_id: input.subject_id,
    ip_address: input.ip_address ?? null,
    user_agent: input.user_agent ?? null,
    checksum: input.checksum ?? null,
    payload: input.payload ?? {},
  };
}

function formatCefLine(event: SiemAuditEvent): string {
  const extension = [
    `rt=${event.timestamp}`,
    `suid=${event.actor_user_id ?? "unknown"}`,
    `cs1=${event.action}`,
    `cs1Label=Action`,
    `cs2=${event.subject_type}`,
    `cs2Label=SubjectType`,
    `cs3=${event.subject_id ?? ""}`,
    `cs3Label=SubjectId`,
    `src=${event.ip_address ?? ""}`,
    `request=${event.trace_id ?? ""}`,
  ].join(" ");

  return `CEF:0|WorkHub|API|1.0|${event.action}|${event.subject_type}|5|${extension}`;
}

export { formatCefLine, formatSiemAuditEvent };
export type { SiemAuditEvent };
