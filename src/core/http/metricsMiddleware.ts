import { prometheusRegistry } from "../metrics/prometheus";
import type { Middleware } from "./middleware";

function normalizeMetricPath(pathname: string): string {
  return pathname.replace(/\/\d+/g, "/:id").replace(/\/[0-9a-f-]{36}/gi, "/:id");
}

function createMetricsMiddleware(): Middleware {
  return async (request: Request, next: () => Promise<Response>) => {
    const startedAt = performance.now();
    const response = await next();
    const durationMs = performance.now() - startedAt;
    const path = normalizeMetricPath(new URL(request.url).pathname);
    const labels = {
      method: request.method,
      path,
      status: String(response.status),
    };

    prometheusRegistry.incrementHttpRequest(labels);
    prometheusRegistry.observeHttpDuration(labels, durationMs);

    return response;
  };
}

export { createMetricsMiddleware, normalizeMetricPath };
