import { currentAuthUser } from "../../core/auth/authContext";
import { currentRequestMeta } from "../../core/http/requestMetaContext";
import { currentTraceId } from "../../core/tracing/traceContext";
import { currentTenantId } from "../../core/tenant/tenantContext";
import { auditChecksum } from "../../core/tenant/tenantMiddleware";
import AuditLogRepository from "./repository";
import type { AuditLogRecord } from "./types";

interface RecordAuditInput {
  action: string;
  subjectType: string;
  subjectId?: number | null;
  payload?: Record<string, unknown>;
  previousPayload?: Record<string, unknown> | null;
}

class AuditService {
  constructor(private readonly repository: AuditLogRepository) {}

  async record(input: RecordAuditInput): Promise<AuditLogRecord> {
    const user = currentAuthUser();
    const meta = currentRequestMeta();
    const payload = input.payload ?? {};

    return await this.repository.create({
      user_id: user ? Number(user.id) : null,
      action: input.action,
      subject_type: input.subjectType,
      subject_id: input.subjectId ?? null,
      payload,
      previous_payload: input.previousPayload ?? null,
      ip_address: meta.ipAddress,
      user_agent: meta.userAgent,
      checksum: auditChecksum(payload),
      tenant_id: currentTenantId(),
      trace_id: currentTraceId(),
      created_at: new Date(),
    });
  }

  async listRecent(limit = 50): Promise<AuditLogRecord[]> {
    return await this.repository.findAll({ limit });
  }
}

export default AuditService;
