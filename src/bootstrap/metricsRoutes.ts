import { timingSafeEqual } from "node:crypto";
import { prometheusRegistry } from "@getstrata/core/metrics/prometheus";

function tokensMatch(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function authorizeMetrics(request: Request): boolean {
  const expected = process.env.METRICS_TOKEN?.trim();
  const authorization = request.headers.get("authorization") ?? "";
  const presented = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";

  if (expected) {
    return presented.length > 0 && tokensMatch(presented, expected);
  }

  if ((process.env.APP_ENV ?? "local") === "production") {
    return false;
  }

  return true;
}

function createMetricsRoutes() {
  return {
    "/metrics": async (request: Request) => {
      if (!authorizeMetrics(request)) {
        return new Response("Not Found", { status: 404 });
      }

      return new Response(prometheusRegistry.renderMetrics(), {
        status: 200,
        headers: {
          "content-type": "text/plain; version=0.0.4; charset=utf-8",
        },
      });
    },
  };
}

export { createMetricsRoutes };
