import { currentSqlDialect } from "../../database/dialect";
import { repositoryConnection as db } from "../../database/repositoryConnection";
import { hasActiveTransaction, runInTransaction } from "../../database/transaction";
import { runWithMigrationBypass } from "../../tenant/databaseTenantContext";

type OutboxMetricState =
  | "pending_due"
  | "pending_waiting"
  | "processing_active"
  | "processing_expired"
  | "processing_unleased"
  | "failed";
interface OutboxMetricsSnapshot {
  sampleLimit: number;
  states: readonly {
    state: OutboxMetricState;
    count: number;
    capped: boolean;
    actionableLatenessSeconds: number | null;
  }[];
}
interface OutboxMetricsOptions {
  timeoutMs?: number;
  sampleLimit?: number;
}
interface OutboxMetricsCollector {
  collect(): Promise<OutboxMetricsSnapshot>;
  /** Stop new collection and wait for the underlying transaction to settle. */
  close(): Promise<void>;
}
const specifications = [
  { state: "pending_due", status: "pending", column: "available_at", predicate: "<=", age: true },
  {
    state: "pending_waiting",
    status: "pending",
    column: "available_at",
    predicate: ">",
    age: false,
  },
  {
    state: "processing_active",
    status: "processing",
    column: "lease_until",
    predicate: ">",
    age: false,
  },
  {
    state: "processing_expired",
    status: "processing",
    column: "lease_until",
    predicate: "<=",
    age: true,
  },
  {
    state: "processing_unleased",
    status: "processing",
    column: "lease_until",
    predicate: "IS NULL",
    age: false,
  },
  { state: "failed", status: "failed", column: "available_at", predicate: "", age: false },
] as const;
// Existing status/time indexes support each capped range. Completed history is never counted.
const snapshotQuery = `WITH snapshot_clock AS MATERIALIZED (
  SELECT CAST(EXTRACT(EPOCH FROM clock_timestamp()) * 1000 AS BIGINT) AS now_ms
), ${specifications
  .map(
    (spec, index) => `sample_${index} AS (
  SELECT ${spec.column} AS timestamp_ms FROM strata_outbox_delivery
  WHERE status = '${spec.status}'${spec.predicate ? ` AND ${spec.column} ${spec.predicate}${spec.predicate === "IS NULL" ? "" : " (SELECT now_ms FROM snapshot_clock)"}` : ""}
  ORDER BY ${spec.column}, event_id, listener_name LIMIT $1
)`,
  )
  .join(",\n")}
${specifications
  .map(
    (spec, index) => `SELECT '${spec.state}' AS state, COUNT(*) AS count,
  ${spec.age ? `COALESCE(GREATEST(0, (SELECT now_ms FROM snapshot_clock) - MIN(timestamp_ms)), 0)` : "NULL::BIGINT"} AS lateness_ms
  FROM sample_${index}`,
  )
  .join("\nUNION ALL\n")}`;

/** Explicit platform observation, using the same transaction-local RLS bypass as coordination.
 * Initially Postgres-only: other engines fail rather than receiving a false empty snapshot.
 */
function createOutboxMetricsCollector(options: OutboxMetricsOptions = {}): OutboxMetricsCollector {
  const timeoutMs = options.timeoutMs ?? 1000;
  const sampleLimit = options.sampleLimit ?? 500;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000)
    throw new TypeError("Outbox metrics timeout must be between 1 and 5000 milliseconds.");
  if (!Number.isSafeInteger(sampleLimit) || sampleLimit < 1 || sampleLimit > 1000)
    throw new TypeError("Outbox metrics sample limit must be between 1 and 1000.");
  let active: Promise<OutboxMetricsSnapshot> | undefined;
  let closed = false;
  return {
    async collect() {
      if (closed) throw new Error("Outbox metrics collector is closed.");
      if (hasActiveTransaction())
        throw new Error("Outbox metrics require an independent transaction.");
      if (currentSqlDialect().driver !== "pgsql")
        throw new Error("Outbox metrics currently require Postgres.");
      if (active) throw new Error("Outbox metrics collection is still settling.");
      const deadline = performance.now() + timeoutMs;
      let expired = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const remaining = () => {
        const value = Math.floor(deadline - performance.now());
        if (expired || value < 1) throw new Error("Outbox metrics collection timed out.");
        return value;
      };
      const work = runInTransaction(async () => {
        // The framework transaction contract does not expose checkout cancellation. If it arrives late,
        // perform no collection. Keep active set until rollback/release completes.
        await db.unsafe("SELECT set_config('statement_timeout', $1, true)", [`${remaining()}ms`]);
        await db.unsafe("SET TRANSACTION READ ONLY");
        return runWithMigrationBypass(async () => {
          remaining();
          const rows = await db.unsafe<{
            state: string;
            count: number | string;
            lateness_ms: number | string | null;
          }>(snapshotQuery, [sampleLimit + 1]);
          remaining();
          if (rows.length !== specifications.length)
            throw new Error("Invalid outbox metrics response.");
          const states = specifications.map((spec) => {
            const row = rows.find((value) => value.state === spec.state);
            const count = Number(row?.count);
            const lateness = row?.lateness_ms == null ? null : Number(row.lateness_ms);
            if (
              !Number.isSafeInteger(count) ||
              count < 0 ||
              count > sampleLimit + 1 ||
              (spec.age && (lateness === null || !Number.isFinite(lateness) || lateness < 0))
            )
              throw new Error("Invalid outbox metrics values.");
            return {
              state: spec.state,
              count: Math.min(count, sampleLimit),
              capped: count > sampleLimit,
              actionableLatenessSeconds: lateness === null ? null : lateness / 1000,
            };
          });
          return { sampleLimit, states };
        });
      });
      active = work;
      // Observe late rejection even after the scrape deadline, with no error/SQL logging.
      void work
        .finally(() => {
          if (active === work) active = undefined;
        })
        .catch(() => {});
      try {
        return await Promise.race([
          work,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              expired = true;
              reject(new Error("Outbox metrics collection timed out."));
            }, timeoutMs);
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

function renderOutboxMetrics(snapshot: OutboxMetricsSnapshot): string {
  if (
    !Number.isSafeInteger(snapshot.sampleLimit) ||
    snapshot.sampleLimit < 1 ||
    snapshot.sampleLimit > 1000 ||
    snapshot.states.length !== specifications.length
  )
    throw new TypeError("Invalid outbox metrics snapshot.");
  const lines = [
    "# HELP strata_outbox_collector_success Whether outbox collection succeeded.",
    "# TYPE strata_outbox_collector_success gauge",
    "strata_outbox_collector_success 1",
    "# HELP strata_outbox_deliveries_sample Bounded per-state delivery count; lower bound when capped.",
    "# TYPE strata_outbox_deliveries_sample gauge",
    "# HELP strata_outbox_sample_capped Whether the delivery sample is truncated.",
    "# TYPE strata_outbox_sample_capped gauge",
    "# HELP strata_outbox_actionable_lateness_seconds Oldest due-time or expired-lease lateness, not original event age.",
    "# TYPE strata_outbox_actionable_lateness_seconds gauge",
  ];
  for (const spec of specifications) {
    const row = snapshot.states.find((value) => value.state === spec.state);
    if (
      !row ||
      !Number.isSafeInteger(row.count) ||
      row.count < 0 ||
      row.count > snapshot.sampleLimit ||
      typeof row.capped !== "boolean" ||
      (row.actionableLatenessSeconds !== null &&
        (!Number.isFinite(row.actionableLatenessSeconds) || row.actionableLatenessSeconds < 0))
    )
      throw new TypeError("Invalid outbox metrics snapshot.");
    lines.push(`strata_outbox_deliveries_sample{state="${spec.state}"} ${row.count}`);
    lines.push(`strata_outbox_sample_capped{state="${spec.state}"} ${Number(row.capped)}`);
    if (row.actionableLatenessSeconds !== null)
      lines.push(
        `strata_outbox_actionable_lateness_seconds{state="${spec.state}"} ${row.actionableLatenessSeconds}`,
      );
  }
  return `${lines.join("\n")}\n`;
}

export type {
  OutboxMetricState,
  OutboxMetricsCollector,
  OutboxMetricsOptions,
  OutboxMetricsSnapshot,
};
// Internal SQL plan fixture; not re-exported by the public outbox entrypoint.
export { createOutboxMetricsCollector, renderOutboxMetrics, snapshotQuery };
