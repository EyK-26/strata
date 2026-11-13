/** Compiled against source and packed exports; not executed. */
import { createMetricsRoutes } from "@getstrata/bootstrap/metricsRoutes";
import type { ReadOnlyObservation } from "@getstrata/core/database/ownedReadOnlyObservation";
import {
  createOutboxMetricsCollector,
  type OutboxMetricsSnapshot,
} from "@getstrata/core/events/outbox";

export async function outboxMetricsContracts(observeReadOnly: ReadOnlyObservation): Promise<void> {
  const collector = createOutboxMetricsCollector({
    observeReadOnly,
    timeoutMs: 1000,
    sampleLimit: 500,
  });
  createMetricsRoutes({ outbox: collector });
  const snapshot: OutboxMetricsSnapshot = await collector.collect();
  const lateness: number | null | undefined = snapshot.states[0]?.actionableLatenessSeconds;
  await collector.close();
  // @ts-expect-error Sample limits are numeric.
  createOutboxMetricsCollector({ observeReadOnly, sampleLimit: "all" });
  // @ts-expect-error Collection must return the official typed snapshot.
  createMetricsRoutes({ outbox: { collect: async () => ({ arbitrary: 1 }) } });
  void lateness;
}
