import { currentAuthUser } from "../../core/auth/authContext";
import AuditLogRepository from "./repository";
import type { AuditLogRecord } from "./types";

interface RecordAuditInput {
  action: string;
  subjectType: string;
  subjectId?: number | null;
  payload?: Record<string, unknown>;
}

class AuditService {
  constructor(private readonly repository: AuditLogRepository) {}

  async record(input: RecordAuditInput): Promise<AuditLogRecord> {
    const user = currentAuthUser();

    return await this.repository.create({
      user_id: user ? Number(user.id) : null,
      action: input.action,
      subject_type: input.subjectType,
      subject_id: input.subjectId ?? null,
      payload: input.payload ?? {},
      created_at: new Date(),
    });
  }

  async listRecent(limit = 50): Promise<AuditLogRecord[]> {
    return await this.repository.findAll({ limit });
  }
}

export default AuditService;
