import { describe, expect, test } from "bun:test";
import { normalizeMetricPath } from "@getstrata/core/http/metricsMiddleware";
import { HTTP_DURATION_BUCKETS_MS, prometheusRegistry } from "@getstrata/core/metrics/prometheus";

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

  test("aggregates durations into a bounded histogram", () => {
    prometheusRegistry.resetForTests();
    const labels = { method: "POST", path: "/api/v1/orders", status: "500" };

    prometheusRegistry.observeHttpDuration(labels, 3);
    prometheusRegistry.observeHttpDuration(labels, 30);
    prometheusRegistry.observeHttpDuration(labels, 20_000);

    for (let index = 0; index < 100_000; index += 1) {
      prometheusRegistry.observeHttpDuration({ method: "GET", path: "/health", status: "200" }, 1);
    }

    const output = prometheusRegistry.renderMetrics();
    const buckets = output
      .split("\n")
      .filter((line) => line.startsWith("http_request_duration_ms_bucket{"));

    expect(buckets).toHaveLength((HTTP_DURATION_BUCKETS_MS.length + 1) * 2);
    expect(output).toContain('le="5"');
    expect(output).toContain('le="+Inf"');
    expect(output).toContain("http_request_duration_ms_count{");
    expect(output).toMatch(
      /http_request_duration_ms_count\{method="GET",path="\/health",status="200"\} 100000/,
    );
    expect(output).not.toContain("100003");
    prometheusRegistry.resetForTests();
  });
});

describe("normalizeMetricPath", () => {
  test("replaces numeric ids with placeholders", () => {
    expect(normalizeMetricPath("/api/v1/projects/42")).toBe("/api/v1/projects/:id");
  });
});
