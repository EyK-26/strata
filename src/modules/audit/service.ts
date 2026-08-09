import { createHash } from "node:crypto";
import { currentAuthUser } from "@getstrata/core/auth/authContext";
import { currentRequestMeta } from "@getstrata/core/http/requestMetaContext";
import { currentTenantId } from "@getstrata/core/tenant/tenantContext";
import { auditChecksum } from "@getstrata/core/tenant/tenantMiddleware";
import { currentTraceId } from "@getstrata/core/tracing/traceContext";
import type AuditLogRepository from "./repository";
import type { AuditLogRecord } from "./types";

interface RecordAuditInput {
  action: string;
  subjectType: string;
  subjectId?: number | null;
  payload?: Record<string, unknown>;
  previousPayload?: Record<string, unknown> | null;
}

function buildChainedChecksum(
  payload: Record<string, unknown>,
  previousChecksum: string | null,
): string {
  return createHash("sha256")
    .update(JSON.stringify({ payload, previous_checksum: previousChecksum }))
    .digest("hex");
}

class AuditService {
  constructor(private readonly repository: AuditLogRepository) {}

  async record(input: RecordAuditInput): Promise<AuditLogRecord> {
    const user = currentAuthUser();
    const meta = currentRequestMeta();
    const payload = input.payload ?? {};
    const tenantId = currentTenantId();
    const previousChecksum = await this.repository.findLatestChecksumForTenant(tenantId);
    const payloadChecksum = auditChecksum(payload);
    const checksum = buildChainedChecksum(
      { ...payload, payload_checksum: payloadChecksum },
      previousChecksum,
    );

    return await this.repository.create({
      user_id: user ? Number(user.id) : null,
      action: input.action,
      subject_type: input.subjectType,
      subject_id: input.subjectId ?? null,
      payload,
      previous_payload: input.previousPayload ?? null,
      ip_address: meta.ipAddress,
      user_agent: meta.userAgent,
      checksum,
      tenant_id: tenantId,
      trace_id: currentTraceId(),
      created_at: new Date(),
    });
  }

  async listRecent(limit = 50): Promise<AuditLogRecord[]> {
    return await this.repository.findAll({
      limit,
      where: { tenant_id: currentTenantId() },
    });
  }
}

export default AuditService;
