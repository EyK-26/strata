import { describe, expect, test } from "bun:test";
import { createMetricsRoutes } from "../../src/bootstrap/metricsRoutes";
import { prometheusRegistry } from "../../src/core/metrics/prometheus";

describe("createMetricsRoutes", () => {
  test("returns prometheus metrics with the expected content type", async () => {
    prometheusRegistry.resetForTests();
    prometheusRegistry.incrementHttpRequest({
      method: "GET",
      path: "/health",
      status: "200",
    });

    const routes = createMetricsRoutes();
    const response = await routes["/metrics"]();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain; version=0.0.4; charset=utf-8");
    expect(await response.text()).toContain("http_requests_total");
  });
});
