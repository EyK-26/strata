import { createPostgresReadOnlyCollector } from "../database/postgresReadOnlyCollector";
import { repositoryConnection as db } from "../database/repositoryConnection";
import FailedJobRepository from "./failedJobRepository";

interface FailedJobMetricsSnapshot {
  sampleLimit: number;
  count: number;
  capped: boolean;
}
interface FailedJobMetricsOptions {
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

function createFailedJobMetricsCollector(
  options: FailedJobMetricsOptions = {},
): FailedJobMetricsCollector {
  const sampleLimit = options.sampleLimit ?? 500;
  if (!Number.isSafeInteger(sampleLimit) || sampleLimit < 1 || sampleLimit > 1000)
    throw new TypeError("Failed-job metrics sample limit must be between 1 and 1000.");
  const repository = new FailedJobRepository();
  return createPostgresReadOnlyCollector(
    "Failed-job metrics",
    options.timeoutMs ?? 1000,
    async (remaining) => {
      // ACCESS SHARE prevents concurrent DDL/RLS/index changes between validation and projection.
      await db.unsafe('LOCK TABLE "failed_job" IN ACCESS SHARE MODE');
      const schema = await db.unsafe<{ supported: boolean }>(schemaQuery);
      if (schema.length !== 1 || schema[0]?.supported !== true)
        throw new Error(
          "Failed-job metrics require the standard global table with an ID primary key and no RLS.",
        );
      remaining();
      const rows = await repository
        .query()
        .orderBy({ column: "id", direction: "ASC" })
        .project(["id"], sampleLimit + 1);
      if (rows.length > sampleLimit + 1 || rows.some((row) => row.id == null))
        throw new Error("Invalid failed-job metrics response.");
      return {
        sampleLimit,
        count: Math.min(rows.length, sampleLimit),
        capped: rows.length > sampleLimit,
      };
    },
  );
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

export type { FailedJobMetricsCollector, FailedJobMetricsOptions, FailedJobMetricsSnapshot };
export { createFailedJobMetricsCollector, renderFailedJobMetrics };
