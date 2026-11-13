import type { SelectedSession } from "../contracts/persistence";

type AuditExportSql = <T>(work: (selected: SelectedSession) => Promise<T>) => Promise<T>;
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

/** The supplied scope selects the application's connection and trusted SQL policy. */
async function readPendingAuditLogs(
  runSql: AuditExportSql,
  batchSize: number,
): Promise<PendingAuditLog[]> {
  return runSql(async (selected) => {
    const rows = await selected.execute<PendingAuditLog>({
      text: `SELECT id,user_id,action,subject_type,subject_id,payload,ip_address,user_agent,checksum,tenant_id,trace_id,created_at
        FROM audit_log WHERE exported_at IS NULL ORDER BY id LIMIT ${selected.dialect.placeholder(1)}`,
      params: [batchSize],
    });
    return rows.map((row) => ({
      ...row,
      created_at: new Date(row.created_at),
      payload: typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload,
    }));
  });
}

async function acknowledgeAuditLogs(runSql: AuditExportSql, ids: readonly number[]): Promise<void> {
  await runSql(async (selected) => {
    for (const id of ids) {
      await selected.execute({
        text: `UPDATE audit_log SET exported_at = ${selected.dialect.nowExpression()} WHERE id = ${selected.dialect.placeholder(1)}`,
        params: [id],
      });
    }
  });
}

export type { AuditExportSql };
export { acknowledgeAuditLogs, readPendingAuditLogs };
