import { BaseRepository } from "@getstrata/core/database/baseRepository";
import { auditLogTable } from "./table";
import type { AuditLogRecord } from "./types";

class AuditLogRepository extends BaseRepository<AuditLogRecord, "id"> {
  constructor() {
    super(auditLogTable);
  }

  async findLatestChecksumForTenant(tenantId: number): Promise<string | null> {
    const rows = await this.findAll({
      where: { tenant_id: tenantId } as never,
      limit: 1,
      orderBy: { column: "id", direction: "DESC" },
    });

    return rows[0]?.checksum ?? null;
  }
}

export default AuditLogRepository;
