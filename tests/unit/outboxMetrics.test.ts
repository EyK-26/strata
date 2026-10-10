import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  bindDatabaseConnection,
  getBoundDatabaseConnection,
  resetBoundDatabaseConnection,
} from "@getstrata/core/database/boundConnection";
import type { UnsafeQueryable } from "@getstrata/core/database/connection";
import { resetSqlDialect, useSqlDialect } from "@getstrata/core/database/dialect";
import { createOutboxMetricsCollector, renderOutboxMetrics } from "@getstrata/core/events/outbox";
import { restoreEnvVar } from "../helpers/restoreEnv";

const states = [
  "pending_due",
  "pending_waiting",
  "processing_active",
  "processing_expired",
  "processing_unleased",
  "failed",
];
let rows: unknown[];
let previous: ReturnType<typeof getBoundDatabaseConnection>;
let tenancy: string | undefined;
beforeEach(() => {
  previous = getBoundDatabaseConnection();
  tenancy = process.env.TENANCY_DRIVER;
  process.env.TENANCY_DRIVER = "none";
  useSqlDialect("pgsql");
  rows = states.map((state) => ({
    state,
    count: 0,
    lateness_ms: state === "pending_due" || state === "processing_expired" ? 0 : null,
  }));
  const unsafe = async <T>(query: string): Promise<T[]> =>
    query.includes("WITH snapshot_clock") ? (rows as T[]) : [];
  bindDatabaseConnection({
    unsafe,
    async begin<T>(run: (tx: UnsafeQueryable) => Promise<T>) {
      return run({ unsafe });
    },
  });
});
afterEach(() => {
  if (previous) bindDatabaseConnection(previous);
  else resetBoundDatabaseConnection();
  resetSqlDialect();
  restoreEnvVar("TENANCY_DRIVER", tenancy);
});

test("malformed database responses fail rather than produce metrics", async () => {
  const valid = rows;
  for (const invalid of [
    [],
    valid.slice(1),
    valid.map((row, index) =>
      index === 0 ? { state: "pending_due", count: -1, lateness_ms: 0 } : row,
    ),
    valid.map((row, index) =>
      index === 0 ? { state: "pending_due", count: 502, lateness_ms: 0 } : row,
    ),
    valid.map((row, index) =>
      index === 0 ? { state: "pending_due", count: 0, lateness_ms: null } : row,
    ),
    valid.map((row, index) =>
      index === 0 ? { state: "pending_due", count: 0, lateness_ms: Infinity } : row,
    ),
  ]) {
    rows = invalid;
    const collector = createOutboxMetricsCollector();
    try {
      await expect(collector.collect()).rejects.toThrow("Invalid outbox metrics");
    } finally {
      await collector.close();
    }
  }
});

test("renderer validates fixed state vocabulary and numeric observations", async () => {
  const collector = createOutboxMetricsCollector();
  const snapshot = await collector.collect();
  expect(renderOutboxMetrics(snapshot)).toContain("strata_outbox_collector_success 1");
  for (const limit of [0, 1001, 1.5])
    expect(() => renderOutboxMetrics({ ...snapshot, sampleLimit: limit })).toThrow();
  expect(() => renderOutboxMetrics({ ...snapshot, states: [] })).toThrow();
  const first = snapshot.states[0];
  if (!first) throw new Error("Missing fixture");
  for (const row of [
    { ...first, count: -1 },
    { ...first, count: 501 },
    { ...first, actionableLatenessSeconds: NaN },
    { ...first, actionableLatenessSeconds: -1 },
  ])
    expect(() =>
      renderOutboxMetrics({ ...snapshot, states: [row, ...snapshot.states.slice(1)] }),
    ).toThrow();
  expect(() =>
    renderOutboxMetrics({ ...snapshot, states: snapshot.states.map(() => first) }),
  ).toThrow();
  await collector.close();
});
