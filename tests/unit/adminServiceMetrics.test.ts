import { describe, expect, test } from "bun:test";
import { prometheusRegistry } from "@getstrata/core/metrics/prometheus";
import AdminService from "../../src/modules/admin/service";

describe("AdminService queue and HTTP metrics", () => {
  test("returns queue metrics and HTTP summary for the dashboard", async () => {
    prometheusRegistry.resetForTests();
    prometheusRegistry.incrementHttpRequest({
      method: "GET",
      path: "/admin",
      status: "200",
    });

    const service = new AdminService();
    const queueMetrics = await service.queueMetrics();
    const httpMetrics = service.httpMetricsSummary();

    expect(queueMetrics.driver).toBeDefined();
    expect(queueMetrics.pending.total).toBeGreaterThanOrEqual(0);
    expect(queueMetrics.failedCount).toBeGreaterThanOrEqual(0);
    expect(httpMetrics.totalRequests).toBe(1);
    expect(httpMetrics.byStatus["200"]).toBe(1);
  });
});
