/** Compiled against source and packed exports. */
import { createMetricsRuntime as rootFactory } from "@getstrata/bootstrap";
import {
  createMetricsRoutes,
  createMetricsRuntime,
  type MetricsRuntime,
  type MetricsRuntimeOptions,
} from "@getstrata/bootstrap/metricsRoutes";

export async function metricsRuntimeContract() {
  const options: MetricsRuntimeOptions = {
    outbox: { sampleLimit: 500 },
    failedJobs: { timeoutMs: 1000 },
    queue: { redisUrl: "redis://localhost", transport: "streams" },
  };
  const runtime: MetricsRuntime = createMetricsRuntime(options);
  createMetricsRoutes(runtime.options);
  await runtime.close();
  await rootFactory().close();
  // @ts-expect-error SQL collector enablement requires typed options, not a boolean.
  createMetricsRuntime({ outbox: true });
  // @ts-expect-error Runtime does not enable worker execution or migration.
  createMetricsRuntime({ migrate: true });
}
