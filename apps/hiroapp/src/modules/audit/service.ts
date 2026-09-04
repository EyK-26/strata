import { createHash } from "node:crypto";
import { currentAuthUser } from "@getstrata/core/auth/authContext";
import { currentRequestMeta } from "@getstrata/core/http/requestMetaContext";
import { currentTenantId } from "@getstrata/core/tenant/tenantContext";
import { auditChecksum } from "@getstrata/core/tenant/tenantMiddleware";
import { currentTraceId } from "@getstrata/core/tracing/traceContext";
import { type AuditLogRecord, auditLogs } from "./repository.ts";

export interface RecordAuditInput {
  action: string;
  subjectType: string;
  subjectId?: number | null;
  payload?: Record<string, unknown>;
  previousPayload?: Record<string, unknown> | null;
}

function chainedChecksum(
  payload: Record<string, unknown>,
  previousChecksum: string | null,
): string {
  return createHash("sha256")
    .update(JSON.stringify({ payload, previous_checksum: previousChecksum }))
    .digest("hex");
}

export class AuditService {
  async record(input: RecordAuditInput): Promise<AuditLogRecord> {
    const user = currentAuthUser();
    const meta = currentRequestMeta();
    const payload = input.payload ?? {};
    const tenantId = currentTenantId();
    const previousChecksum = await auditLogs.findLatestChecksumForTenant(tenantId);
    const checksum = chainedChecksum(
      { ...payload, payload_checksum: auditChecksum(payload) },
      previousChecksum,
    );
    return auditLogs.create({
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
    return auditLogs.findAll({
      limit,
      orderBy: { column: "id", direction: "DESC" },
    });
  }
}

export const auditService = new AuditService();
