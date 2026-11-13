import type { SqlStatement } from "../database/driverPorts";
import { buildSelectQuery } from "../database/query";
import type { SqlDialect } from "../database/sqlDialects";
import { failedJobTable } from "./failedJobTable";

interface ReadOnlyObservationExecutor {
  readonly dialect: SqlDialect;
  execute<Row>(statement: SqlStatement): Promise<readonly Row[]>;
}
type FailedJobObservation = <T>(
  timeoutMs: number,
  work: (database: ReadOnlyObservationExecutor, remaining: () => number) => Promise<T>,
) => Promise<T>;

interface FailedJobMetricsSnapshot {
  sampleLimit: number;
  count: number;
  capped: boolean;
}
interface FailedJobMetricsOptions {
  /** Application-owned interruptible read-only observation; no ambient pool fallback. */
  observeReadOnly: FailedJobObservation;
  timeoutMs?: number;
  sampleLimit?: number;
}
interface FailedJobMetricsCollector {
  collect(): Promise<FailedJobMetricsSnapshot>;
  close(): Promise<void>;
}
// Fixed catalog lookup; refuse hidden RLS rows or a schema lacking the standard ID primary key.
const schemaQuery = `SELECT c.relkind = 'r' AND c.relpersistence = 'p' AND NOT c.relrowsecurity AND EXISTS (
  SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
  WHERE i.indrelid = c.oid AND i.indisprimary AND i.indisvalid AND i.indisready
    AND i.indnkeyatts = 1 AND a.attname = 'id' AND NOT a.attisdropped
    AND a.atttypid IN ('int2'::regtype, 'int4'::regtype, 'int8'::regtype)
) AS supported FROM pg_class c WHERE c.oid = 'failed_job'::regclass`;

const sqliteSchemaQuery = `SELECT 1 AS supported FROM main.sqlite_schema
WHERE name='failed_job' AND type='table' AND rootpage > 0
AND (SELECT COUNT(*) FROM pragma_table_xinfo('failed_job', 'main') WHERE pk > 0) = 1
AND EXISTS (SELECT 1 FROM pragma_table_xinfo('failed_job', 'main')
  WHERE name='id' AND pk=1 AND upper(type)='INTEGER' AND hidden=0) LIMIT 1`;

const mysqlSchemaQuery = `SELECT 1 AS supported FROM information_schema.TABLES t
WHERE t.TABLE_SCHEMA=DATABASE() AND t.TABLE_NAME='failed_job' AND t.TABLE_TYPE='BASE TABLE' AND t.ENGINE='InnoDB'
AND (SELECT COUNT(*) FROM information_schema.STATISTICS i WHERE i.TABLE_SCHEMA=t.TABLE_SCHEMA
  AND i.TABLE_NAME=t.TABLE_NAME AND i.INDEX_NAME='PRIMARY')=1
AND EXISTS(SELECT 1 FROM information_schema.STATISTICS i JOIN information_schema.COLUMNS c
  ON c.TABLE_SCHEMA=i.TABLE_SCHEMA AND c.TABLE_NAME=i.TABLE_NAME AND c.COLUMN_NAME=i.COLUMN_NAME
  WHERE i.TABLE_SCHEMA=t.TABLE_SCHEMA AND i.TABLE_NAME=t.TABLE_NAME AND i.INDEX_NAME='PRIMARY'
    AND i.SEQ_IN_INDEX=1 AND i.COLUMN_NAME='id' AND c.DATA_TYPE IN ('tinyint','smallint','mediumint','int','bigint')) LIMIT 1`;

function createFailedJobMetricsCollector(
  options: FailedJobMetricsOptions,
): FailedJobMetricsCollector {
  if (typeof options.observeReadOnly !== "function")
    throw new TypeError("Failed-job metrics require an explicit read-only observation runner.");
  const sampleLimit = options.sampleLimit ?? 500;
  if (!Number.isSafeInteger(sampleLimit) || sampleLimit < 1 || sampleLimit > 1000)
    throw new TypeError("Failed-job metrics sample limit must be between 1 and 1000.");
  const timeoutMs = options.timeoutMs ?? 1000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000)
    throw new TypeError("Failed-job metrics timeout must be between 1 and 5000 milliseconds.");
  let active: Promise<FailedJobMetricsSnapshot> | undefined;
  let closed = false;
  return {
    async collect() {
      if (closed) throw new Error("Failed-job metrics collector is closed.");
      if (active) throw new Error("Failed-job metrics collection is still settling.");
      const work = options.observeReadOnly(timeoutMs, async (database, remaining) => {
        // ACCESS SHARE prevents concurrent DDL/RLS/index changes between validation and projection.
        const driver = database.dialect.driver;
        const postgres = driver === "pgsql";
        if (postgres)
          await database.execute({
            text: 'LOCK TABLE "failed_job" IN ACCESS SHARE MODE',
            params: [],
          });
        if (driver === "mysql")
          await database.execute({ text: "SELECT id FROM failed_job LIMIT 0", params: [] });
        const schema = await database.execute<{ supported: boolean | number }>({
          text: postgres ? schemaQuery : driver === "mysql" ? mysqlSchemaQuery : sqliteSchemaQuery,
          params: [],
        });
        if (schema.length !== 1 || schema[0]?.supported !== (postgres ? true : 1))
          throw new Error(
            "Failed-job metrics require the standard global table with an ID primary key and no RLS.",
          );
        remaining();
        const rows = await database.execute<{ id: number }>(
          buildSelectQuery(database.dialect, failedJobTable, {
            select: [{ kind: "column", table: failedJobTable.name, column: "id" }],
            orderBy: { column: "id", direction: "ASC" },
            limit: sampleLimit + 1,
          }),
        );
        if (rows.length > sampleLimit + 1 || rows.some((row) => row.id == null))
          throw new Error("Invalid failed-job metrics response.");
        return {
          sampleLimit,
          count: Math.min(rows.length, sampleLimit),
          capped: rows.length > sampleLimit,
        };
      });
      active = work;
      void work
        .finally(() => {
          if (active === work) active = undefined;
        })
        .catch(() => {});
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          work,
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("Failed-job metrics collection timed out.")),
              timeoutMs,
            );
          }),
        ]);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    },
    async close() {
      closed = true;
      await active?.catch(() => {});
    },
  };
}
function renderFailedJobMetrics(snapshot: FailedJobMetricsSnapshot): string {
  if (
    !Number.isSafeInteger(snapshot.sampleLimit) ||
    snapshot.sampleLimit < 1 ||
    snapshot.sampleLimit > 1000 ||
    !Number.isSafeInteger(snapshot.count) ||
    snapshot.count < 0 ||
    snapshot.count > snapshot.sampleLimit ||
    typeof snapshot.capped !== "boolean" ||
    (snapshot.capped && snapshot.count !== snapshot.sampleLimit)
  )
    throw new TypeError("Invalid failed-job metrics snapshot.");
  return `# HELP strata_queue_failed_job_collector_success Whether failed-job collection succeeded.
# TYPE strata_queue_failed_job_collector_success gauge
strata_queue_failed_job_collector_success 1
# HELP strata_queue_failed_jobs_sample Capped retained failed-job count; a lower bound when capped.
# TYPE strata_queue_failed_jobs_sample gauge
strata_queue_failed_jobs_sample ${snapshot.count}
# HELP strata_queue_failed_jobs_sample_capped Whether the failed-job sample is truncated.
# TYPE strata_queue_failed_jobs_sample_capped gauge
strata_queue_failed_jobs_sample_capped ${Number(snapshot.capped)}
`;
}

export type {
  FailedJobMetricsCollector,
  FailedJobMetricsOptions,
  FailedJobMetricsSnapshot,
  FailedJobObservation,
  ReadOnlyObservationExecutor,
};
export { createFailedJobMetricsCollector, renderFailedJobMetrics };
