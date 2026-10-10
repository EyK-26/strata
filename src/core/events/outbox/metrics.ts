import { currentSqlDialect } from "../../database/dialect";
import { createReadOnlyCollector } from "../../database/readOnlyCollector";
import { repositoryConnection as db } from "../../database/repositoryConnection";
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

async function readSqliteSnapshot(sampleLimit: number, remaining: () => number) {
  const schema = await db.unsafe<{ valid: number }>(
    "SELECT 1 AS valid FROM main.sqlite_schema WHERE name='strata_outbox_delivery' AND type='table' AND rootpage>0 LIMIT 1",
  );
  if (schema.length !== 1 || schema[0]?.valid !== 1)
    throw new Error("Outbox metrics require the standard delivery table.");
  for (const [index, column] of [
    ["strata_outbox_due", "available_at"],
    ["strata_outbox_expired", "lease_until"],
  ]) {
    const rows = await db.unsafe<{ name: string; seqno: number }>(
      "SELECT name, seqno FROM pragma_index_info(?, 'main') ORDER BY seqno LIMIT 5",
      [index],
    );
    const expected = ["status", column, "event_id", "listener_name"];
    if (
      rows.length !== expected.length ||
      rows.some((row, i) => row.seqno !== i || row.name !== expected[i])
    )
      throw new Error("Outbox metrics require the standard delivery indexes.");
    remaining();
  }
  const [clock] = await db.unsafe<{ now_ms: number }>(
    "SELECT CAST(unixepoch('subsec') * 1000 AS INTEGER) AS now_ms",
  );
  if (!Number.isSafeInteger(clock?.now_ms) || !clock || clock.now_ms < 0)
    throw new Error("Invalid outbox clock.");
  const rows = [];
  for (const spec of specifications) {
    remaining();
    const index = spec.column === "lease_until" ? "strata_outbox_expired" : "strata_outbox_due";
    const predicate = spec.predicate
      ? ` AND ${spec.column} ${spec.predicate}${spec.predicate === "IS NULL" ? "" : " ?"}`
      : "";
    const values = await db.unsafe<{ timestamp_ms: number | null }>(
      `SELECT ${spec.column} AS timestamp_ms
      FROM strata_outbox_delivery INDEXED BY ${index} WHERE status = ?${predicate}
      ORDER BY ${spec.column}, event_id, listener_name LIMIT ?`,
      [
        spec.status,
        ...(spec.predicate && spec.predicate !== "IS NULL" ? [clock.now_ms] : []),
        sampleLimit + 1,
      ],
    );
    const timestamp = values[0]?.timestamp_ms;
    if (
      spec.age &&
      values.length &&
      (!Number.isSafeInteger(timestamp) || timestamp == null || timestamp < 0)
    )
      throw new Error("Invalid outbox timestamp.");
    rows.push({
      state: spec.state,
      count: values.length,
      lateness_ms: spec.age ? Math.max(0, clock.now_ms - (timestamp ?? clock.now_ms)) : null,
    });
  }
  return rows;
}

/** Explicit platform observation, using the same transaction-local RLS bypass as coordination.
 * Postgres uses scoped bypass; file-backed SQLite uses an isolated read-only snapshot.
 */
function createOutboxMetricsCollector(options: OutboxMetricsOptions = {}): OutboxMetricsCollector {
  const timeoutMs = options.timeoutMs ?? 1000;
  const sampleLimit = options.sampleLimit ?? 500;
  if (!Number.isSafeInteger(sampleLimit) || sampleLimit < 1 || sampleLimit > 1000)
    throw new TypeError("Outbox metrics sample limit must be between 1 and 1000.");
  return createReadOnlyCollector("Outbox metrics", timeoutMs, async (remaining) => {
    const read = async () => {
      remaining();
      const rows =
        currentSqlDialect().driver === "sqlite"
          ? await readSqliteSnapshot(sampleLimit, remaining)
          : await db.unsafe<{
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
    };
    return currentSqlDialect().driver === "pgsql" ? runWithMigrationBypass(read) : read();
  });
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
