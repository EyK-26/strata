import type { Middleware } from "@getstrata/core/http/middleware";
import { currentRequestMeta, runWithRequestMeta } from "@getstrata/core/http/requestMetaContext";
import { readClientIp } from "../http/clientIp";
import { appLogger } from "./logger";

function createRequestLoggingMiddleware(): Middleware {
  return async (request: Request, next: () => Promise<Response>) => {
    return await runWithRequestMeta(
      {
        ...currentRequestMeta(),
        ipAddress: readClientIp(request) ?? null,
        userAgent: request.headers.get("user-agent"),
        request,
      },
      async () => {
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
      },
    );
  };
}

export { createRequestLoggingMiddleware };
