import { describe, expect, test } from "bun:test";
import { prometheusRegistry } from "../../src/core/metrics/prometheus";
import { collectQueueMetrics } from "../../src/core/queue/queueMetrics";

describe("prometheusRegistry.getHttpRequestSummary", () => {
  test("summarizes request counts by status and path", () => {
    prometheusRegistry.resetForTests();
    prometheusRegistry.incrementHttpRequest({
      method: "GET",
      path: "/api/v1/projects",
      status: "200",
    });
    prometheusRegistry.incrementHttpRequest({
      method: "GET",
      path: "/api/v1/projects",
      status: "200",
    });
    prometheusRegistry.incrementHttpRequest({
      method: "POST",
      path: "/api/v1/projects",
      status: "422",
    });

    const summary = prometheusRegistry.getHttpRequestSummary();

    expect(summary.totalRequests).toBe(3);
    expect(summary.byStatus).toEqual({ "200": 2, "422": 1 });
    expect(summary.topPaths[0]).toEqual({
      method: "GET",
      path: "/api/v1/projects",
      count: 2,
    });
  });
});

describe("collectQueueMetrics", () => {
  test("returns zero pending counts for sync driver", async () => {
    const previousDriver = process.env.QUEUE_DRIVER;
    process.env.QUEUE_DRIVER = "sync";

    try {
      const metrics = await collectQueueMetrics();

      expect(metrics.driver).toBe("sync");
      expect(metrics.pending).toEqual({
        high: 0,
        default: 0,
        low: 0,
        total: 0,
      });
      expect(metrics.failedCount).toBeGreaterThanOrEqual(0);
    } finally {
      if (previousDriver === undefined) {
        delete process.env.QUEUE_DRIVER;
      } else {
        process.env.QUEUE_DRIVER = previousDriver;
      }
    }
  });
});
