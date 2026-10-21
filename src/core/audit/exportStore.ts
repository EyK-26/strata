import { repositoryConnection as db } from "@getstrata/core/database/repositoryConnection";
import { runWithMigrationBypass } from "../tenant/databaseTenantContext";

type PendingAuditLog = {
  id: number;
  user_id: number | null;
  action: string;
  subject_type: string;
  subject_id: number | null;
  payload: Record<string, unknown>;
  ip_address: string | null;
  user_agent: string | null;
  checksum: string | null;
  tenant_id: number | null;
  trace_id: string | null;
  created_at: Date;
};

async function readPendingAuditLogs(batchSize: number): Promise<PendingAuditLog[]> {
  return await runWithMigrationBypass(async () => {
    return (await db`
      SELECT
        id,
        user_id,
        action,
        subject_type,
        subject_id,
        payload,
        ip_address,
        user_agent,
        checksum,
        tenant_id,
        trace_id,
        created_at
      FROM audit_log
      WHERE exported_at IS NULL
      ORDER BY id
      LIMIT ${batchSize}
    `) as PendingAuditLog[];
  });
}

async function acknowledgeAuditLogs(ids: readonly number[]): Promise<void> {
  await runWithMigrationBypass(async () => {
    for (const id of ids) {
      await db`UPDATE audit_log SET exported_at = NOW() WHERE id = ${id}`;
    }
  });
}

export { acknowledgeAuditLogs, readPendingAuditLogs };
