import { appEnv } from "../runtime/appKeyPrefix";
import { safeFetch } from "../security/safeFetch";
import { assertSafeOutboundUrl } from "../security/safeUrl";
import { acknowledgeAuditLogs, readPendingAuditLogs } from "./exportStore";
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

  assertSafeOutboundUrl(endpoint, { allowHttp: appEnv() !== "production" });

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

  // Each store call owns only its SQL scope. A caller-owned outer transaction
  // remains the caller's responsibility; the exporter never commits it.
  const rows = await readPendingAuditLogs(config.batchSize);

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

  const response = await safeFetch(
    config.endpoint,
    {
      method: "POST",
      headers: {
        "content-type": config.format === "cef" ? "text/plain" : "application/json",
        ...(process.env.SIEM_EXPORT_TOKEN
          ? { authorization: `Bearer ${process.env.SIEM_EXPORT_TOKEN}` }
          : {}),
      },
      body,
    },
    { allowHttp: appEnv() !== "production" },
  );

  if (!response.ok) {
    throw new Error(`SIEM export failed with status ${response.status}.`);
  }

  await acknowledgeAuditLogs(rows.map((row) => row.id));
  return rows.length;
}

export { exportPendingAuditLogs, resolveAuditExportConfig };
