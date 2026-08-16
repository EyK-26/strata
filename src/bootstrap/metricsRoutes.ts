import { prometheusRegistry } from "@getstrata/core/metrics/prometheus";

function createMetricsRoutes() {
  return {
    "/metrics": async () =>
      new Response(prometheusRegistry.renderMetrics(), {
        status: 200,
        headers: {
          "content-type": "text/plain; version=0.0.4; charset=utf-8",
        },
      }),
  };
}

export { createMetricsRoutes };
