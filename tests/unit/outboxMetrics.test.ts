import { beforeEach, expect, test } from "bun:test";
import {
  createOwnedReadOnlyObservation,
  type ReadOnlyObservation,
} from "@getstrata/core/database/ownedReadOnlyObservation";
import { dialectFor } from "@getstrata/core/database/sqlDialects";
import { createOutboxMetricsCollector, renderOutboxMetrics } from "@getstrata/core/events/outbox";
import { createApplication } from "@getstrata/core/runtime/application";

const states = [
  "pending_due",
  "pending_waiting",
  "processing_active",
  "processing_expired",
  "processing_unleased",
  "failed",
];
let rows: unknown[];
let observeReadOnly: ReadOnlyObservation;
beforeEach(() => {
  rows = states.map((state) => ({
    state,
    count: 0,
    lateness_ms: state === "pending_due" || state === "processing_expired" ? 0 : null,
  }));
  observeReadOnly = async (_timeout, work) =>
    work(
      {
        dialect: dialectFor("pgsql"),
        execute: async <R>({ text }: import("@getstrata/core/database/driverPorts").SqlStatement) =>
          (text.includes("WITH snapshot_clock") ? rows : []) as R[],
      },
      () => 1000,
    );
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
    const collector = createOutboxMetricsCollector({ observeReadOnly });
    try {
      await expect(collector.collect()).rejects.toThrow("Invalid outbox metrics");
    } finally {
      await collector.close();
    }
  }
});

test("renderer validates fixed state vocabulary and numeric observations", async () => {
  const collector = createOutboxMetricsCollector({ observeReadOnly });
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

test("portable observation refuses invalid adapter clocks and row timestamps", async () => {
  for (const broken of ["clock", "timestamp"]) {
    const unsafe = async <T>(query: string, params: readonly unknown[] = []): Promise<T[]> => {
      const result = query.includes("information_schema.TABLES")
        ? [{ valid: 1 }]
        : query.includes("information_schema.STATISTICS")
          ? [
              "status",
              params[0] === "strata_outbox_due" ? "available_at" : "lease_until",
              "event_id",
              "listener_name",
            ].map((name, seqno) => ({ name, seqno }))
          : query.includes("AS now_ms")
            ? [{ now_ms: broken === "clock" ? -1 : 1000 }]
            : query.includes("AS timestamp_ms")
              ? [{ timestamp_ms: -1 }]
              : [];
      return result as T[];
    };
    observeReadOnly = async (_timeout, work) =>
      work(
        {
          dialect: dialectFor("mysql"),
          execute: (statement) => unsafe(statement.text, statement.params),
        },
        () => 1000,
      );
    const collector = createOutboxMetricsCollector({ observeReadOnly });
    try {
      await expect(collector.collect()).rejects.toThrow(
        broken === "clock" ? "Invalid outbox clock" : "Invalid outbox timestamp",
      );
    } finally {
      await collector.close();
    }
  }
});

test("an unsupported immutable observation driver is rejected before application effects", () => {
  const dialect = dialectFor("pgsql");
  expect(Object.isFrozen(dialect)).toBe(true);
  expect(Reflect.set(dialect, "driver", "unsupported")).toBe(false);
  let effects = 0;
  const app = createApplication({
    providers: [
      {
        name: "fixture",
        setup() {
          effects++;
        },
      },
    ],
  });
  expect(() =>
    createOwnedReadOnlyObservation(app, "main", { driver: "unsupported" } as never),
  ).toThrow("Unsupported SQL driver");
  expect(effects).toBe(0);
  expect(dialectFor("pgsql")).toBe(dialect);
});

test("metrics construction requires its explicit observation runner without an ambient fallback", () => {
  for (const observeReadOnly of [undefined, null, {}, "default"]) {
    expect(() => createOutboxMetricsCollector({ observeReadOnly } as never)).toThrow(
      "Outbox metrics require an explicit read-only observation runner",
    );
  }
});
