import { appConfig } from "../../config/app";
import db from "../../db/connection";
import { safeFetch } from "../security/safeFetch";
import { assertSafeOutboundUrl } from "../security/safeUrl";
import { runWithMigrationBypass } from "../tenant/databaseTenantContext";
import { formatCefLine, formatSiemAuditEvent } from "./siemFormatter";

interface AuditExportConfig {
  endpoint: string;
  format: "json" | "cef";
  batchSize: number;
}

function resolveAuditExportConfig(): AuditExportConfig | null {
  const endpoint = process.env.SIEM_EXPORT_URL?.trim();

  if (!endpoint) {
    return null;
  }

  assertSafeOutboundUrl(endpoint, { allowHttp: appConfig.env !== "production" });

  const batchSize = Number(process.env.SIEM_EXPORT_BATCH_SIZE ?? "100");

  return {
    endpoint,
    format: process.env.SIEM_EXPORT_FORMAT === "cef" ? "cef" : "json",
    batchSize: Number.isFinite(batchSize) ? batchSize : 100,
  };
}

async function exportPendingAuditLogs(): Promise<number> {
  const config = resolveAuditExportConfig();

  if (!config) {
    return 0;
  }

  return await runWithMigrationBypass(async () => {
    const rows = (await db`
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
      LIMIT ${config.batchSize}
    `) as Array<{
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
    }>;

    if (rows.length === 0) {
      return 0;
    }

    const events = rows.map((row) =>
      formatSiemAuditEvent({
        action: row.action,
        subject_type: row.subject_type,
        subject_id: row.subject_id,
        user_id: row.user_id,
        tenant_id: row.tenant_id,
        trace_id: row.trace_id,
        ip_address: row.ip_address,
        user_agent: row.user_agent,
        checksum: row.checksum,
        payload: row.payload,
        created_at: row.created_at,
      }),
    );

    const body =
      config.format === "cef"
        ? events.map((event) => formatCefLine(event)).join("\n")
        : JSON.stringify({ events });

    const response = await safeFetch(config.endpoint, {
      method: "POST",
      headers: {
        "content-type": config.format === "cef" ? "text/plain" : "application/json",
        ...(process.env.SIEM_EXPORT_TOKEN
          ? { authorization: `Bearer ${process.env.SIEM_EXPORT_TOKEN}` }
          : {}),
      },
      body,
    });

    if (!response.ok) {
      throw new Error(`SIEM export failed with status ${response.status}.`);
    }

    const ids = rows.map((row) => row.id);

    for (const id of ids) {
      await db`UPDATE audit_log SET exported_at = NOW() WHERE id = ${id}`;
    }

    return rows.length;
  });
}

export { exportPendingAuditLogs, resolveAuditExportConfig };
