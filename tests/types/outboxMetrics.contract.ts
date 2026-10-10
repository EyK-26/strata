/** Compiled against source and packed exports; not executed. */
import { createMetricsRoutes } from "@getstrata/bootstrap/metricsRoutes";
import {
  createOutboxMetricsCollector,
  type OutboxMetricsSnapshot,
} from "@getstrata/core/events/outbox";

export async function outboxMetricsContracts(): Promise<void> {
  const collector = createOutboxMetricsCollector({ timeoutMs: 1000, sampleLimit: 500 });
  createMetricsRoutes({ outbox: collector });
  const snapshot: OutboxMetricsSnapshot = await collector.collect();
  const lateness: number | null | undefined = snapshot.states[0]?.actionableLatenessSeconds;
  await collector.close();
  // @ts-expect-error Sample limits are numeric.
  createOutboxMetricsCollector({ sampleLimit: "all" });
  // @ts-expect-error Collection must return the official typed snapshot.
  createMetricsRoutes({ outbox: { collect: async () => ({ arbitrary: 1 }) } });
  void lateness;
}
