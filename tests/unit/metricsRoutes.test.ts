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

test("unauthorized scrapes never start an opted-in Redis collection", async () => {
  const previousToken = process.env.METRICS_TOKEN;
  process.env.METRICS_TOKEN = "fixture-token";
  let connections = 0;
  const server = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open() {
        connections++;
      },
      data() {},
    },
  });
  try {
    const routes = createMetricsRoutes({
      queue: { redisUrl: `redis://127.0.0.1:${server.port}`, timeoutMs: 50 },
    });
    expect((await routes["/metrics"](metricsRequest())).status).toBe(404);
    expect(connections).toBe(0);
  } finally {
    server.stop(true);
    restoreEnvVar("METRICS_TOKEN", previousToken);
  }
});

test("outbox failure preserves HTTP metrics and exposes failure rather than empty delivery counts", async () => {
  const previousToken = process.env.METRICS_TOKEN;
  process.env.METRICS_TOKEN = "fixture-token";
  let calls = 0;
  try {
    const routes = createMetricsRoutes({
      outbox: {
        async collect() {
          calls++;
          throw new Error("secret database detail");
        },
      },
    });
    expect((await routes["/metrics"](metricsRequest())).status).toBe(404);
    expect(calls).toBe(0);
    const response = await routes["/metrics"](
      metricsRequest({ authorization: "Bearer fixture-token" }),
    );
    const body = await response.text();
    expect(body).toContain("http_requests_total");
    expect(body).toContain("strata_outbox_collector_success 0");
    expect(body).not.toContain("strata_outbox_deliveries_sample");
    expect(body).not.toContain("secret database detail");
    expect(calls).toBe(1);
  } finally {
    restoreEnvVar("METRICS_TOKEN", previousToken);
  }
});
