const ACQUISITION_BUCKETS_SECONDS = [
  0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
] as const;
const outcomes = ["acquired", "failed", "aborted"] as const;
type AcquisitionOutcome = (typeof outcomes)[number];
interface AcquisitionHistogram {
  outcome: AcquisitionOutcome;
  count: number;
  sumSeconds: number;
  buckets: readonly number[];
}
interface TransactionAcquisitionSnapshot {
  inflight: number;
  outcomes: readonly AcquisitionHistogram[];
}
const metricsBrand: unique symbol = Symbol("transaction acquisition metrics");
interface TransactionAcquisitionMetrics {
  readonly [metricsBrand]: true;
  snapshot(): TransactionAcquisitionSnapshot;
}
type MutableHistogram = Omit<AcquisitionHistogram, "buckets"> & { buckets: number[] };
type State = { inflight: number; outcomes: MutableHistogram[] };
const states = new WeakMap<TransactionAcquisitionMetrics, State>();

function createTransactionAcquisitionMetrics(): TransactionAcquisitionMetrics {
  const state: State = {
    inflight: 0,
    outcomes: outcomes.map((outcome) => ({
      outcome,
      count: 0,
      sumSeconds: 0,
      buckets: ACQUISITION_BUCKETS_SECONDS.map(() => 0),
    })),
  };
  const metrics: TransactionAcquisitionMetrics = {
    [metricsBrand]: true,
    snapshot: () => ({
      inflight: state.inflight,
      outcomes: state.outcomes.map((histogram) => ({
        ...histogram,
        buckets: [...histogram.buckets],
      })),
    }),
  };
  states.set(metrics, state);
  return metrics;
}

/** Internal native-reservation boundary, never a business/BEGIN/savepoint timer. */
async function observeTransactionAcquisition<T>(
  metrics: TransactionAcquisitionMetrics,
  acquire: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const state = states.get(metrics);
  if (!state)
    throw new TypeError(
      "Transaction acquisition metrics must be created by the framework factory.",
    );
  const started = performance.now();
  state.inflight++;
  let outcome: AcquisitionOutcome = "acquired";
  try {
    return await acquire();
  } catch (error) {
    outcome = signal?.aborted ? "aborted" : "failed";
    throw error;
  } finally {
    state.inflight--;
    const elapsed = Math.max(0, performance.now() - started) / 1000;
    // All outcomes are fixed; no caller-provided label, error or sample is retained.
    const histogram = state.outcomes[outcomes.indexOf(outcome)];
    if (histogram) {
      histogram.count++;
      histogram.sumSeconds += elapsed;
      for (let index = 0; index < ACQUISITION_BUCKETS_SECONDS.length; index++) {
        const bound = ACQUISITION_BUCKETS_SECONDS[index];
        if (bound !== undefined && elapsed <= bound)
          histogram.buckets[index] = (histogram.buckets[index] ?? 0) + 1;
      }
    }
  }
}

function renderTransactionAcquisitionMetrics(snapshot: TransactionAcquisitionSnapshot): string {
  const invalid = () => new TypeError("Invalid transaction acquisition metrics.");
  if (
    !Number.isSafeInteger(snapshot.inflight) ||
    snapshot.inflight < 0 ||
    snapshot.outcomes.length !== outcomes.length
  )
    throw invalid();
  const name = "strata_database_transaction_acquisition_duration_seconds";
  const lines = [
    "# HELP strata_database_acquisition_collector_success Whether transaction acquisition observation succeeded.",
    "# TYPE strata_database_acquisition_collector_success gauge",
    "strata_database_acquisition_collector_success 1",
    "# HELP strata_database_transaction_acquisition_inflight Native transaction checkouts awaiting settlement in this process.",
    "# TYPE strata_database_transaction_acquisition_inflight gauge",
    `strata_database_transaction_acquisition_inflight ${snapshot.inflight}`,
    `# HELP ${name} Native checkout duration, including pool wait and connection establishment, for explicitly observed transactions.`,
    `# TYPE ${name} histogram`,
  ];
  for (let i = 0; i < outcomes.length; i++) {
    const histogram = snapshot.outcomes[i];
    if (
      !histogram ||
      histogram.outcome !== outcomes[i] ||
      !Number.isSafeInteger(histogram.count) ||
      histogram.count < 0 ||
      !Number.isFinite(histogram.sumSeconds) ||
      histogram.sumSeconds < 0 ||
      histogram.buckets.length !== ACQUISITION_BUCKETS_SECONDS.length
    )
      throw invalid();
    let previous = 0;
    for (let index = 0; index < ACQUISITION_BUCKETS_SECONDS.length; index++) {
      const value = histogram.buckets[index];
      if (
        value === undefined ||
        !Number.isSafeInteger(value) ||
        value < previous ||
        value > histogram.count
      )
        throw invalid();
      previous = value;
      lines.push(
        `${name}_bucket{outcome="${histogram.outcome}",le="${ACQUISITION_BUCKETS_SECONDS[index]}"} ${value}`,
      );
    }
    lines.push(
      `${name}_bucket{outcome="${histogram.outcome}",le="+Inf"} ${histogram.count}`,
      `${name}_count{outcome="${histogram.outcome}"} ${histogram.count}`,
      `${name}_sum{outcome="${histogram.outcome}"} ${histogram.sumSeconds}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

export type { TransactionAcquisitionMetrics, TransactionAcquisitionSnapshot };
export {
  createTransactionAcquisitionMetrics,
  observeTransactionAcquisition,
  renderTransactionAcquisitionMetrics,
};
