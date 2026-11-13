import { type EnvRecord, isProductionEnv } from "../runtime/appEnv";
import { appKeyPrefix } from "../runtime/appKeyPrefix";
import { safeFetch } from "../security/safeFetch";
import { assertSafeOutboundUrl } from "../security/safeUrl";
import { type AuditExportSql, acknowledgeAuditLogs, readPendingAuditLogs } from "./exportStore";
import { formatCefLine, formatSiemAuditEvent } from "./siemFormatter";

interface AuditExportConfig {
  endpoint: string;
  format: "json" | "cef";
  batchSize: number;
}

function resolveAuditExportConfig(env: EnvRecord = process.env): AuditExportConfig | null {
  const endpoint = env.SIEM_EXPORT_URL?.trim();

  if (!endpoint) {
    return null;
  }

  assertSafeOutboundUrl(endpoint, { allowHttp: !isProductionEnv(env) });

  const batchSize = Number(env.SIEM_EXPORT_BATCH_SIZE ?? "100");

  return {
    endpoint,
    format: env.SIEM_EXPORT_FORMAT === "cef" ? "cef" : "json",
    batchSize: Number.isFinite(batchSize) ? batchSize : 100,
  };
}

interface AuditExporterOptions {
  readonly runSql: AuditExportSql;
  readonly environment: EnvRecord;
}

/** Capture policy once; each SQL scope settles before the outbound HTTP boundary. */
function createAuditExporter(options: AuditExporterOptions): () => Promise<number> {
  const env = Object.freeze({ ...options.environment });
  const config = resolveAuditExportConfig(env);
  const runSql = options.runSql;
  const token = env.SIEM_EXPORT_TOKEN;
  const eventType = env.SIEM_EVENT_TYPE?.trim() || `${appKeyPrefix(env)}.audit`;
  const displayName = env.APP_NAME?.trim() || "Strata";
  return async () => {
    if (!config) {
      return 0;
    }

    // Each store call owns only its SQL scope. A caller-owned outer transaction
    // remains the caller's responsibility; the exporter never commits it.
    const rows = await readPendingAuditLogs(runSql, config.batchSize);

    if (rows.length === 0) {
      return 0;
    }

    const events = rows.map((row) =>
      formatSiemAuditEvent(
        {
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
        },
        eventType,
      ),
    );

    const body =
      config.format === "cef"
        ? events.map((event) => formatCefLine(event, displayName)).join("\n")
        : JSON.stringify({ events });

    const response = await safeFetch(
      config.endpoint,
      {
        method: "POST",
        headers: {
          "content-type": config.format === "cef" ? "text/plain" : "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body,
      },
      { allowHttp: !isProductionEnv(env) },
    );

    if (!response.ok) {
      throw new Error(`SIEM export failed with status ${response.status}.`);
    }

    await acknowledgeAuditLogs(
      runSql,
      rows.map((row) => row.id),
    );
    return rows.length;
  };
}

function exportPendingAuditLogs(
  runSql: AuditExportSql,
  environment: EnvRecord = process.env,
): Promise<number> {
  return createAuditExporter({ runSql, environment })();
}

export type { AuditExportConfig, AuditExporterOptions, AuditExportSql };
export { createAuditExporter, exportPendingAuditLogs, resolveAuditExportConfig };
