import { createMetricsRoutes } from "@getstrata/bootstrap/metricsRoutes";
import {
  createFailedJobMetricsCollector,
  type FailedJobMetricsCollector,
  type FailedJobMetricsSnapshot,
  renderFailedJobMetrics,
} from "@getstrata/core";
import type { FailedJobObservation } from "@getstrata/core/queue/failedJobMetrics";
import { createFailedJobMetricsCollector as fromSubpath } from "@getstrata/core/queue/queueMetrics";
export async function failedJobMetricsContract(
  observeReadOnly: FailedJobObservation,
): Promise<void> {
  const collector: FailedJobMetricsCollector = createFailedJobMetricsCollector({
    observeReadOnly,
    timeoutMs: 1000,
    sampleLimit: 500,
  });
  const snapshot: FailedJobMetricsSnapshot = await collector.collect();
  const text: string = renderFailedJobMetrics(snapshot);
  createMetricsRoutes({ failedJobs: collector });
  await collector.close();
  await fromSubpath({ observeReadOnly }).close();
  // @ts-expect-error Never configure implicit string deadlines.
  createFailedJobMetricsCollector({ observeReadOnly, timeoutMs: "1000" });
  // @ts-expect-error No caller-controlled labels/payloads enter the snapshot.
  renderFailedJobMetrics({ ...snapshot, tenantId: "private" });
  void text;
}
