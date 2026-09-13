import { describe, expect, test } from "bun:test";
import { createMetricsRoutes } from "@getstrata/bootstrap/metricsRoutes";
import { prometheusRegistry } from "@getstrata/core/metrics/prometheus";
import { restoreEnvVar } from "../helpers/restoreEnv";

function metricsRequest(headers?: Record<string, string>): Request {
  return new Request("http://localhost/metrics", { headers });
}

describe("createMetricsRoutes", () => {
  test("returns prometheus metrics with the expected content type", async () => {
    prometheusRegistry.resetForTests();
    prometheusRegistry.incrementHttpRequest({
      method: "GET",
      path: "/health",
      status: "200",
    });

    const routes = createMetricsRoutes();
    const response = await routes["/metrics"](metricsRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain; version=0.0.4; charset=utf-8");
    expect(await response.text()).toContain("http_requests_total");
  });

  test("hides metrics in staging unless METRICS_TOKEN is presented", async () => {
    const previousEnv = process.env.APP_ENV;
    const previousToken = process.env.METRICS_TOKEN;
    process.env.APP_ENV = "staging";
    delete process.env.METRICS_TOKEN;

    try {
      const routes = createMetricsRoutes();
      expect((await routes["/metrics"](metricsRequest())).status).toBe(404);
    } finally {
      restoreEnvVar("APP_ENV", previousEnv);
      restoreEnvVar("METRICS_TOKEN", previousToken);
    }
  });

  test("hides metrics in production unless METRICS_TOKEN is presented", async () => {
    const previousEnv = process.env.APP_ENV;
    const previousToken = process.env.METRICS_TOKEN;
    process.env.APP_ENV = "production";
    delete process.env.METRICS_TOKEN;

    try {
      const routes = createMetricsRoutes();
      const response = await routes["/metrics"](metricsRequest());

      expect(response.status).toBe(404);
    } finally {
      restoreEnvVar("APP_ENV", previousEnv);
      restoreEnvVar("METRICS_TOKEN", previousToken);
    }
  });

  test("requires a matching bearer token when METRICS_TOKEN is set", async () => {
    const previousToken = process.env.METRICS_TOKEN;
    process.env.METRICS_TOKEN = "metrics-secret";

    try {
      const routes = createMetricsRoutes();

      expect((await routes["/metrics"](metricsRequest())).status).toBe(404);
      expect(
        (await routes["/metrics"](metricsRequest({ authorization: "Bearer wrong-secret" }))).status,
      ).toBe(404);
      expect(
        (await routes["/metrics"](metricsRequest({ authorization: "Bearer metrics-secret" })))
          .status,
      ).toBe(200);
    } finally {
      restoreEnvVar("METRICS_TOKEN", previousToken);
    }
  });
});
