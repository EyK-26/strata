import { TenantRepository } from "../../lib/tenantRepository.ts";
import { type AuditLogRecord, auditLogTable } from "./table.ts";

class AuditLogRepository extends TenantRepository<AuditLogRecord, "id"> {
  async findLatestChecksumForTenant(tenantId: number): Promise<string | null> {
    const rows = await this.findAll({
      where: { tenant_id: tenantId } as never,
      limit: 1,
      orderBy: { column: "id", direction: "DESC" },
    });
    return rows[0]?.checksum ?? null;
  }
}

export const auditLogs = new AuditLogRepository(auditLogTable);
export type { AuditLogRecord };
