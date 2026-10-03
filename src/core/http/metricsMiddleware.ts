import { prometheusRegistry } from "../metrics/prometheus";
import type { Middleware } from "./middleware";
import { currentRequestMeta } from "./requestMetaContext";

function createMetricsMiddleware(): Middleware {
  return async (request: Request, next: () => Promise<Response>) => {
    const startedAt = performance.now();
    let response: Response | undefined;
    try {
      response = await next();
      return response;
    } finally {
      const labels = {
        method: request.method,
        path: currentRequestMeta().routeTemplate ?? "__unmatched__",
        status: String(response?.status ?? 500),
      };
      prometheusRegistry.incrementHttpRequest(labels);
      prometheusRegistry.observeHttpDuration(labels, performance.now() - startedAt);
    }
  };
}

export { createMetricsMiddleware };
