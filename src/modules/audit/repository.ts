import { BaseRepository } from "../../core/database";
import { auditLogTable } from "./table";
import type { AuditLogRecord } from "./types";

class AuditLogRepository extends BaseRepository<AuditLogRecord, "id"> {
  constructor() {
    super(auditLogTable);
  }
}

export default AuditLogRepository;
