import { describe, expect, test } from "bun:test";
import { prometheusRegistry } from "../../src/core/metrics/prometheus";
import { normalizeMetricPath } from "../../src/core/http/metricsMiddleware";

describe("prometheusRegistry", () => {
  test("renders counter metrics", () => {
    prometheusRegistry.resetForTests();
    prometheusRegistry.incrementHttpRequest({
      method: "GET",
      path: "/api/v1/projects",
      status: "200",
    });

    const output = prometheusRegistry.renderMetrics();
    expect(output).toContain("http_requests_total");
    expect(output).toContain('method="GET"');
  });
});

describe("normalizeMetricPath", () => {
  test("replaces numeric ids with placeholders", () => {
    expect(normalizeMetricPath("/api/v1/projects/42")).toBe("/api/v1/projects/:id");
  });
});
