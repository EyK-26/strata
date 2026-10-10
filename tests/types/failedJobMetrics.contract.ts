import { createMetricsRoutes } from "@getstrata/bootstrap/metricsRoutes";
import {
  createFailedJobMetricsCollector,
  type FailedJobMetricsCollector,
  type FailedJobMetricsSnapshot,
  renderFailedJobMetrics,
} from "@getstrata/core";
import { createFailedJobMetricsCollector as fromSubpath } from "@getstrata/core/queue/queueMetrics";
export async function failedJobMetricsContract(): Promise<void> {
  const collector: FailedJobMetricsCollector = createFailedJobMetricsCollector({
    timeoutMs: 1000,
    sampleLimit: 500,
  });
  const snapshot: FailedJobMetricsSnapshot = await collector.collect();
  const text: string = renderFailedJobMetrics(snapshot);
  createMetricsRoutes({ failedJobs: collector });
  await collector.close();
  await fromSubpath().close();
  // @ts-expect-error Never configure implicit string deadlines.
  createFailedJobMetricsCollector({ timeoutMs: "1000" });
  // @ts-expect-error No caller-controlled labels/payloads enter the snapshot.
  renderFailedJobMetrics({ ...snapshot, tenantId: "private" });
  void text;
}
