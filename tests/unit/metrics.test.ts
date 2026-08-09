import { describe, expect, test } from "bun:test";
import { normalizeMetricPath } from "@getstrata/core/http/metricsMiddleware";
import { prometheusRegistry } from "@getstrata/core/metrics/prometheus";

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
