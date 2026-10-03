import { describe, expect, test } from "bun:test";
import { createWebServer } from "@getstrata/bootstrap/web/server";
import { createMetricsMiddleware } from "@getstrata/core/http/metricsMiddleware";
import { applyMiddlewareToRoutes, composeMiddleware } from "@getstrata/core/http/middleware";
import { currentRequestMeta } from "@getstrata/core/http/requestMetaContext";
import {
  HTTP_DURATION_BUCKETS_MS,
  PrometheusRegistry,
  prometheusRegistry,
} from "@getstrata/core/metrics/prometheus";

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

describe("bounded route metrics", () => {
  test("caps retained storage and scrape output under 100,000 unique labels", () => {
    const registry = new PrometheusRegistry(8);
    for (let index = 0; index < 100_000; index += 1) {
      const labels = { method: `METHOD${index}`, path: `/unknown/${index}`, status: "999" };
      registry.incrementHttpRequest(labels);
      registry.observeHttpDuration(labels, 12);
    }
    expect(registry.getStorageStats()).toEqual({ series: 9, histograms: 9, bucketCounters: 99 });
    expect(registry.getHttpRequestSummary().totalRequests).toBe(100_000);
    const output = registry.renderMetrics();
    expect(output).toContain('path="__overflow__"');
    expect(output.length).toBeLessThan(20_000);
    for (let index = 0; index < 100; index += 1) {
      expect(registry.renderMetrics().length).toBe(output.length);
    }
    registry.resetForTests();
    expect(registry.getStorageStats().series).toBe(0);
  });

  test("validates storage limits, escapes labels, and rejects invalid observations", () => {
    expect(() => new PrometheusRegistry(0)).toThrow();
    expect(() => new PrometheusRegistry(1.5)).toThrow();
    const registry = new PrometheusRegistry(2);
    const labels = { method: "GET", path: '/a"b\\c\nd', status: "200" };
    registry.incrementHttpRequest(labels);
    for (const duration of [NaN, Infinity, -1]) registry.observeHttpDuration(labels, duration);
    registry.observeHttpDuration(labels, 0);
    expect(registry.getStorageStats().histograms).toBe(1);
    expect(registry.renderMetrics()).toContain('path="/a\\"b\\\\c\\nd"');
    expect(registry.getHttpRequestSummary().topPaths[0]?.path).toBe(labels.path);
    registry.incrementHttpRequest({ ...labels, path: "x".repeat(1000) });
    expect(registry.renderMetrics()).not.toContain("x".repeat(1000));
  });

  test("unknown URLs share one series and thrown errors are observed", async () => {
    prometheusRegistry.resetForTests();
    const handler = composeMiddleware(createMetricsMiddleware())(
      () => new Response(null, { status: 404 }),
    );
    for (let index = 0; index < 10_000; index += 1) {
      await handler(new Request(`http://example.test/arbitrary-slug-${index}?token=secret`));
    }
    const failure = composeMiddleware(createMetricsMiddleware())(() => {
      throw new Error("failure");
    });
    await expect(failure(new Request("http://example.test/fail"))).rejects.toThrow("failure");
    expect(prometheusRegistry.getStorageStats().series).toBe(2);
    expect(prometheusRegistry.renderMetrics()).toContain(
      'path="__unmatched__",status="404"} 10000',
    );
    expect(prometheusRegistry.renderMetrics()).not.toContain("secret");
    expect(prometheusRegistry.getHttpRequestSummary().byStatus["500"]).toBe(1);
    prometheusRegistry.resetForTests();
  });

  test("real Bun JSON/HTML route maps preserve templates across concurrent requests", async () => {
    prometheusRegistry.resetForTests();
    const routes = applyMiddlewareToRoutes(
      {
        "/api/orders/:slug": {
          GET: async () => {
            await Bun.sleep(1);
            return Response.json({ route: currentRequestMeta().routeTemplate });
          },
        },
        "/products/:slug": async () => {
          await Bun.sleep(1);
          return new Response(currentRequestMeta().routeTemplate);
        },
      },
      [createMetricsMiddleware()],
    );
    const unmatched = composeMiddleware(createMetricsMiddleware())(
      () => new Response(null, { status: 404 }),
    );
    const server = createWebServer({ port: 0, routes, handle: unmatched });
    try {
      const responses = await Promise.all(
        Array.from({ length: 100 }, async (_, index) => {
          const prefix = index % 2 ? "/products" : "/api/orders";
          const response = await fetch(
            new URL(`${prefix}/slug-${index}?private=hidden`, server.url),
          );
          return { prefix, body: await response.text() };
        }),
      );
      for (const { prefix, body } of responses) expect(body).toContain(`${prefix}/:slug`);
      for (let index = 0; index < 10; index += 1) {
        await fetch(new URL(`/random-path-${index}`, server.url));
      }
      expect(prometheusRegistry.getStorageStats().series).toBe(3);
      expect(prometheusRegistry.getHttpRequestSummary().totalRequests).toBe(110);
      expect(prometheusRegistry.renderMetrics()).not.toContain("slug-99");
      expect(prometheusRegistry.renderMetrics()).not.toContain("hidden");
    } finally {
      await server.stop(true);
      prometheusRegistry.resetForTests();
    }
  });
});
