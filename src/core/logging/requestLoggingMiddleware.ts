import { appLogger } from "./logger";
import type { Middleware } from "../http/middleware";

function createRequestLoggingMiddleware(): Middleware {
  return async (request: Request, next: () => Promise<Response>) => {
    const startedAt = performance.now();
    const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
    const response = await next();
    const durationMs = Math.round(performance.now() - startedAt);

    appLogger.info("HTTP request completed", {
      requestId,
      method: request.method,
      path: new URL(request.url).pathname,
      status: response.status,
      durationMs,
    });

    return response;
  };
}

export { createRequestLoggingMiddleware };
